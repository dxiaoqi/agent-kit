// ── Context Recall（话题回温）─────────────────────────────────────
// 压缩后建立话题索引，新输入与索引匹配，命中时从 transcript 恢复相关片段。
//
// 设计原则：
// 1. 零外部依赖：不需要 embedding 模型，使用 TF-IDF 关键词匹配
// 2. Token 预算控制：回温内容有上限，不会反过来撑爆上下文
// 3. 渐进衰减：越久远的索引匹配分越低，优先回温近期内容
// 4. 透明注入：以 [Recovered context] 消息注入，LLM 知道这是恢复的内容

import type { Message } from "./message.js";
import { getTextContent, getToolUses, getToolResults } from "./message.js";
import { estimateTokens } from "./token.js";

// ── CompactIndex：一次压缩产生的索引 ─────────────────────────────

export interface CompactIndexEntry {
    /** 索引 ID（递增） */
    id: number;
    /** 压缩时间戳 */
    timestamp: number;
    /** 该段对话涉及的话题关键词（去重、小写） */
    keywords: string[];
    /** 涉及的文件路径 */
    filePaths: string[];
    /** 使用过的工具名 */
    toolNames: string[];
    /** 该段对话的摘要（auto_compact 生成的） */
    summary: string;
    /** 原始消息快照（序列化后的 Message[]，用于精确恢复） */
    originalMessages: Message[];

    // ── Reconsolidation 字段（再固化机制）──────────────────────
    /** 被成功回温的次数（每次回忆都强化记忆痕迹） */
    recallCount: number;
    /** 最近一次被回温的时间戳 */
    lastRecalledAt: number;
    /** 该段对话中 critical/high salience 消息的比例（0-1） */
    salienceScore: number;
}

// ── 关键词提取 ──────────────────────────────────────────────────

const STOP_WORDS = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "dare", "ought",
    "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
    "as", "into", "through", "during", "before", "after", "above", "below",
    "between", "out", "off", "over", "under", "again", "further", "then",
    "once", "here", "there", "when", "where", "why", "how", "all", "each",
    "every", "both", "few", "more", "most", "other", "some", "such", "no",
    "not", "only", "own", "same", "so", "than", "too", "very", "just",
    "because", "but", "and", "or", "if", "while", "that", "this", "it",
    "its", "i", "me", "my", "we", "our", "you", "your", "he", "him",
    "his", "she", "her", "they", "them", "their", "what", "which", "who",
    "whom", "these", "those", "am", "up", "about", "any", "also",
    // 中文常见停用词
    "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一",
    "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着",
    "没有", "看", "好", "自己", "这", "他", "她", "它", "们",
    // Agent 对话常见噪声词
    "please", "help", "thanks", "okay", "sure", "yes", "no", "file",
    "code", "function", "tool", "result", "error", "output", "input",
]);

/**
 * 从文本中提取有意义的关键词。
 * 策略：分词 → 去停用词 → 去短词 → 提取文件路径和标识符
 */
export function extractKeywords(text: string): string[] {
    const keywords = new Set<string>();

    // 提取文件路径（/foo/bar.ts, ./src/main.ts）
    const pathMatches = text.match(/(?:\.{0,2}\/)?[\w\-./]+\.\w{1,10}/g);
    if (pathMatches) {
        for (const p of pathMatches) {
            keywords.add(p.toLowerCase());
            const basename = p.split("/").pop();
            if (basename) keywords.add(basename.toLowerCase());
        }
    }

    // 提取 camelCase / PascalCase 标识符
    const identifiers = text.match(/[A-Z][a-z]+(?:[A-Z][a-z]+)+|[a-z]+(?:[A-Z][a-z]+)+/g);
    if (identifiers) {
        for (const id of identifiers) {
            keywords.add(id.toLowerCase());
            // 拆解 camelCase → 各个单词
            const parts = id.replace(/([A-Z])/g, " $1").toLowerCase().trim().split(/\s+/);
            for (const part of parts) {
                if (part.length > 2 && !STOP_WORDS.has(part)) keywords.add(part);
            }
        }
    }

    // 提取中文关键词（连续 2+ 个中文字符）
    const zhMatches = text.match(/[\u4e00-\u9fff]{2,}/g);
    if (zhMatches) {
        for (const zh of zhMatches) keywords.add(zh);
    }

    // 通用分词
    const words = text.toLowerCase().split(/[\s\-_.,;:!?()[\]{}"'`/\\|<>@#$%^&*+=~]+/);
    for (const word of words) {
        if (word.length > 2 && !STOP_WORDS.has(word) && !/^\d+$/.test(word)) {
            keywords.add(word);
        }
    }

    return [...keywords];
}

/**
 * 从一组消息中提取所有涉及的文件路径。
 */
export function extractFilePaths(messages: readonly Message[]): string[] {
    const paths = new Set<string>();
    for (const msg of messages) {
        for (const block of msg.content) {
            if (block.type === "tool_use") {
                const p = (block.input.path ?? block.input.file_path ?? block.input.file) as string | undefined;
                if (p) paths.add(p);
                const pattern = block.input.pattern as string | undefined;
                if (pattern) paths.add(pattern);
            }
            if (block.type === "tool_result") {
                const fileMatches = block.content.match(/(?:\.{0,2}\/)?[\w\-./]+\.\w{1,10}/g);
                if (fileMatches) {
                    for (const f of fileMatches.slice(0, 20)) paths.add(f);
                }
            }
        }
    }
    return [...paths];
}

/**
 * 从消息中提取使用过的工具名。
 */
export function extractToolNames(messages: readonly Message[]): string[] {
    const names = new Set<string>();
    for (const msg of messages) {
        for (const tu of getToolUses(msg)) {
            names.add(tu.name);
        }
    }
    return [...names];
}

// ── CompactIndex 管理器 ─────────────────────────────────────────

export class CompactIndexStore {
    private readonly entries: CompactIndexEntry[] = [];
    private nextId = 1;

    /**
     * 在 auto_compact 时调用：索引被压缩的消息。
     */
    addEntry(messages: readonly Message[], summary: string): CompactIndexEntry {
        const allText = messages
            .map(m => getTextContent(m))
            .join(" ");

        // 计算 salience 得分：critical/high 消息的占比
        const total = messages.length || 1;
        const salientCount = messages.filter(m => {
            const s = m.metadata?.salience;
            return s === "critical" || s === "high";
        }).length;

        const entry: CompactIndexEntry = {
            id: this.nextId++,
            timestamp: Date.now(),
            keywords: extractKeywords(allText),
            filePaths: extractFilePaths(messages),
            toolNames: extractToolNames(messages),
            summary,
            originalMessages: [...messages],
            recallCount: 0,
            lastRecalledAt: 0,
            salienceScore: salientCount / total,
        };

        this.entries.push(entry);
        return entry;
    }

    /**
     * Reconsolidation：回温成功后强化索引条目。
     * - 更新 lastRecalledAt → 重置时间衰减
     * - 递增 recallCount → 间隔重复效应
     * - 扩展关键词 → 用当前上下文丰富索引
     */
    reinforce(entryId: number, newKeywords?: string[]): void {
        const entry = this.entries.find(e => e.id === entryId);
        if (!entry) return;

        entry.recallCount++;
        entry.lastRecalledAt = Date.now();

        if (newKeywords?.length) {
            const existing = new Set(entry.keywords);
            for (const kw of newKeywords) {
                if (!existing.has(kw)) {
                    entry.keywords.push(kw);
                    existing.add(kw);
                }
            }
        }
    }

    get size(): number {
        return this.entries.length;
    }

    get all(): readonly CompactIndexEntry[] {
        return this.entries;
    }
}

// ── TopicMatcher：相关性匹配 ─────────────────────────────────────

export interface RecallMatch {
    entry: CompactIndexEntry;
    score: number;
    matchedKeywords: string[];
    matchedPaths: string[];
    matchedTools: string[];
}

/**
 * 计算新输入与历史索引的相关性。
 * 综合三维匹配：关键词 + 文件路径 + 工具名。
 * 带时间衰减：越久远的索引得分越低。
 */
export function matchTopics(
    input: string,
    recentMessages: readonly Message[],
    index: CompactIndexStore,
    options: { minScore?: number } = {},
): RecallMatch[] {
    const minScore = options.minScore ?? 0.15;

    if (index.size === 0) return [];

    // 从新输入 + 最近几条消息中提取查询特征
    const recentText = recentMessages
        .slice(-4)
        .map(m => getTextContent(m))
        .join(" ");
    const queryText = input + " " + recentText;
    const queryKeywords = new Set(extractKeywords(queryText));
    const queryPaths = new Set(extractFilePaths(recentMessages.slice(-4)));
    const queryTools = new Set(extractToolNames(recentMessages.slice(-4)));

    const now = Date.now();
    const results: RecallMatch[] = [];

    for (const entry of index.all) {
        const matchedKeywords: string[] = [];
        const matchedPaths: string[] = [];
        const matchedTools: string[] = [];

        // 关键词匹配
        for (const kw of entry.keywords) {
            if (queryKeywords.has(kw)) matchedKeywords.push(kw);
        }

        // 文件路径匹配（精确 + 前缀）
        for (const fp of entry.filePaths) {
            if (queryPaths.has(fp)) {
                matchedPaths.push(fp);
            } else {
                for (const qp of queryPaths) {
                    if (fp.includes(qp) || qp.includes(fp)) {
                        matchedPaths.push(fp);
                        break;
                    }
                }
            }
        }

        // 工具名匹配
        for (const tn of entry.toolNames) {
            if (queryTools.has(tn)) matchedTools.push(tn);
        }

        // 计算分数
        const keywordScore = entry.keywords.length > 0
            ? matchedKeywords.length / Math.sqrt(entry.keywords.length)
            : 0;
        const pathScore = matchedPaths.length * 0.3;
        const toolScore = matchedTools.length * 0.1;

        // 间隔重复效应：每次成功回温使半衰期延长 50%
        // 初始半衰期 30 分钟，回温 1 次 → 45 分钟，2 次 → 67 分钟...
        const halfLife = 30 * Math.pow(1.5, entry.recallCount);

        // 时间衰减：基于上次接触时间（压缩时间 vs 上次回温时间，取更近的）
        const lastTouch = Math.max(entry.timestamp, entry.lastRecalledAt);
        const ageMinutes = (now - lastTouch) / 60_000;
        const timeDecay = Math.pow(0.5, ageMinutes / halfLife);

        // Reconsolidation 加成：被回温过的记忆更容易再次被激活
        const reconsolidationBoost = 1 + Math.min(entry.recallCount * 0.15, 0.6);

        // Salience 加成：包含高重要性内容的索引更抗遗忘
        const salienceBoost = 1 + entry.salienceScore * 0.5;

        const rawScore = keywordScore + pathScore + toolScore;
        const score = rawScore * (0.3 + 0.7 * timeDecay) * reconsolidationBoost * salienceBoost;

        if (score >= minScore) {
            results.push({ entry, score, matchedKeywords, matchedPaths, matchedTools });
        }
    }

    return results.sort((a, b) => b.score - a.score);
}

// ── ContextRecovery：从索引恢复消息 ──────────────────────────────

export interface RecoveryResult {
    recoveredMessages: Message[];
    tokensUsed: number;
    sourceEntries: number[];
}

/**
 * 根据匹配结果，从 CompactIndex 中恢复相关消息片段。
 *
 * 策略：
 * 1. 按匹配分数降序处理
 * 2. 从原始消息中选择最相关的片段（含匹配关键词的消息）
 * 3. 严格遵守 token 预算
 * 4. 包装为 [Recovered context] 消息
 */
export function recoverContext(
    matches: RecallMatch[],
    tokenBudget: number,
): RecoveryResult {
    const recovered: Message[] = [];
    let tokensUsed = 0;
    const sourceEntries: number[] = [];

    for (const match of matches) {
        if (tokensUsed >= tokenBudget) break;

        const relevantMsgs = selectRelevantMessages(
            match.entry.originalMessages,
            new Set([...match.matchedKeywords, ...match.matchedPaths]),
        );

        const fragments: string[] = [];
        for (const msg of relevantMsgs) {
            const text = getTextContent(msg);
            if (!text) continue;

            const costEstimate = estimateTokens(text);
            if (tokensUsed + costEstimate > tokenBudget) break;

            fragments.push(`[${msg.role}]: ${text}`);
            tokensUsed += costEstimate;
        }

        if (fragments.length > 0) {
            // 还有预算时把摘要也带上（提供全局上下文）
            const summaryText = match.entry.summary;
            const summaryCost = estimateTokens(summaryText);
            let contextText: string;

            if (tokensUsed + summaryCost <= tokenBudget) {
                contextText = [
                    `[Recovered context from earlier conversation — relevance: ${Math.round(match.score * 100)}%]`,
                    `[Summary]: ${summaryText}`,
                    ``,
                    `[Relevant fragments]:`,
                    ...fragments,
                ].join("\n");
                tokensUsed += summaryCost;
            } else {
                contextText = [
                    `[Recovered context from earlier conversation — relevance: ${Math.round(match.score * 100)}%]`,
                    `[Relevant fragments]:`,
                    ...fragments,
                ].join("\n");
            }

            recovered.push({
                role: "user",
                content: [{ type: "text", text: contextText }],
                metadata: { compacted: true, timestamp: Date.now() },
            });
            sourceEntries.push(match.entry.id);
        }
    }

    return { recoveredMessages: recovered, tokensUsed, sourceEntries };
}

/**
 * 从一组消息中筛选出与匹配关键词相关的消息。
 * 保留 user/assistant 消息中包含任一匹配词的消息，最多返回 6 条。
 */
function selectRelevantMessages(
    messages: readonly Message[],
    matchedTerms: Set<string>,
): Message[] {
    if (matchedTerms.size === 0) return messages.slice(-4);

    const scored: Array<{ msg: Message; relevance: number }> = [];

    for (const msg of messages) {
        if (msg.role !== "user" && msg.role !== "assistant") continue;

        const text = getTextContent(msg).toLowerCase();
        if (!text) continue;

        let relevance = 0;
        for (const term of matchedTerms) {
            if (text.includes(term.toLowerCase())) relevance++;
        }

        if (relevance > 0) {
            scored.push({ msg, relevance });
        }
    }

    return scored
        .sort((a, b) => b.relevance - a.relevance)
        .slice(0, 6)
        .map(s => s.msg);
}
