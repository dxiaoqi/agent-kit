// ── ContextManager（重写）──────────────────────────────────────────
// 统一管理上下文窗口：消息存储、token 追踪、三层压缩、文件热度、会话持久化。
// Agent Loop 只通过 ContextManager 操作消息，不再直接持有 Message[]。

import type { Message, ContentBlock } from "./message.js";
import {
    systemMessage,
    userMessage,
    assistantMessage,
    toolResultMessage,
    getTextContent,
    toOpenAIMessages,
    type OpenAIMessage,
} from "./message.js";
import { TokenTracker, estimateMessagesTokens } from "./token.js";
import { microCompact, autoCompact, type CompactSummarizer } from "./compact.js";
import { FileFreshnessService } from "./freshness.js";
import { TranscriptLogger } from "./transcript.js";
import {
    CompactIndexStore,
    matchTopics,
    recoverContext,
    extractKeywords as extractKeywordsFromQuery,
    type RecallMatch,
    type RecoveryResult,
} from "./recall.js";
import { detectSalience } from "./salience.js";

// ── 配置 ─────────────────────────────────────────────────────────

export interface ContextManagerConfig {
    systemPrompt: string;
    contextWindow: number;
    /** 会话日志目录，null 禁用 */
    transcriptDir?: string | null;
    /** 会话 ID */
    sessionId?: string;
    /** 回温 token 预算（默认 contextWindow 的 10%） */
    recallBudgetPercent?: number;
}

// ── CompactResult ─────────────────────────────────────────────────

export interface CompactResult {
    summary: string;
    tokensBefore: number;
    tokensAfter: number;
    messagesBefore: number;
    messagesAfter: number;
}

export interface RecallInfo {
    recovered: boolean;
    tokensUsed: number;
    sourceEntries: number[];
    matchCount: number;
    /** 弱匹配的元认知提示（"舌尖效应"——模糊感觉有相关记忆） */
    metamemoryHints: string[];
}

// ── ContextManager ───────────────────────────────────────────────

export class ContextManager {
    private messages: Message[] = [];
    private systemPrompt: string;
    private readonly tokenTracker: TokenTracker;
    private readonly freshness = new FileFreshnessService();
    private readonly transcript: TranscriptLogger | null;
    private readonly compactIndex = new CompactIndexStore();
    private readonly recallBudgetPercent: number;
    private compactCount = 0;
    private lastRecall: RecallInfo = { recovered: false, tokensUsed: 0, sourceEntries: [], matchCount: 0, metamemoryHints: [] };

    constructor(config: ContextManagerConfig) {
        this.systemPrompt = config.systemPrompt;
        this.tokenTracker = new TokenTracker(config.contextWindow);
        this.recallBudgetPercent = config.recallBudgetPercent ?? 0.1;

        if (config.transcriptDir) {
            this.transcript = new TranscriptLogger(config.transcriptDir, config.sessionId);
            this.transcript.logSessionStart({ contextWindow: config.contextWindow });
        } else {
            this.transcript = null;
        }
    }

    // ── 消息操作 ─────────────────────────────────────────────────

    addUserMessage(content: string): void {
        const msg = userMessage(content);
        msg.metadata = { ...msg.metadata, timestamp: Date.now(), salience: detectSalience(msg) };
        this.messages.push(msg);
        this.transcript?.logMessage(msg);
        this.refreshTokenCount();
    }

    addAssistantMessage(text: string, toolUses?: ContentBlock.ToolUse[]): void {
        const msg = assistantMessage(text, toolUses);
        msg.metadata = { ...msg.metadata, timestamp: Date.now(), salience: detectSalience(msg) };
        this.messages.push(msg);
        this.transcript?.logMessage(msg);
        this.refreshTokenCount();
    }

    addToolResult(toolCallId: string, output: string, isError = false): void {
        const msg = toolResultMessage(toolCallId, output, isError);
        msg.metadata = { ...msg.metadata, timestamp: Date.now(), salience: detectSalience(msg) };
        this.messages.push(msg);
        this.transcript?.logMessage(msg);
        this.refreshTokenCount();
    }

    updateSystemPrompt(prompt: string): void {
        this.systemPrompt = prompt;
        this.refreshTokenCount();
    }

    // ── 文件热度追踪 ────────────────────────────────────────────

    trackFileRead(filePath: string): void {
        this.freshness.trackRead(filePath);
    }

    trackFileWrite(filePath: string): void {
        this.freshness.trackWrite(filePath);
    }

    getHottestFiles(limit = 10): string[] {
        return this.freshness.getHottestPaths(limit);
    }

    // ── 压缩管线 ─────────────────────────────────────────────────

    /**
     * Layer 1: micro_compact — 静默裁剪旧 tool_result。
     * 在每轮 LLM 调用前自动执行。
     * @returns 是否执行了压缩
     */
    runMicroCompact(): boolean {
        if (!this.tokenTracker.needsMicroCompact) return false;

        const before = this.tokenTracker.tokens;
        this.messages = microCompact(this.messages);
        this.refreshTokenCount();
        const after = this.tokenTracker.tokens;

        if (after < before) {
            this.transcript?.logCompactEvent({
                beforeTokens: before,
                afterTokens: after,
                summary: `micro_compact: truncated old tool results`,
                messageCountBefore: this.messages.length,
                messageCountAfter: this.messages.length,
            });
            return true;
        }
        return false;
    }

    /**
     * Layer 2: auto_compact — LLM 摘要压缩。
     * 在 micro_compact 后仍超阈值时触发。
     * @returns CompactResult 或 null（未执行）
     */
    async runAutoCompact(summarizer: CompactSummarizer): Promise<CompactResult | null> {
        if (!this.tokenTracker.needsAutoCompact) return null;

        const tokensBefore = this.tokenTracker.tokens;
        const messagesBefore = this.messages.length;
        const messagesToIndex = [...this.messages];

        // 持久化完整上下文（信息不丢失）
        this.transcript?.logMessages(this.messages);

        // LLM 摘要
        const compacted = await autoCompact(this.messages, summarizer);
        const summary = getTextContent(compacted[0]);

        // 建立话题索引（用于后续回温）
        this.compactIndex.addEntry(messagesToIndex, summary);

        this.messages = compacted;
        this.refreshTokenCount();
        this.compactCount++;

        const result: CompactResult = {
            summary,
            tokensBefore,
            tokensAfter: this.tokenTracker.tokens,
            messagesBefore,
            messagesAfter: this.messages.length,
        };

        this.transcript?.logCompactEvent({
            beforeTokens: result.tokensBefore,
            afterTokens: result.tokensAfter,
            summary: result.summary,
            messageCountBefore: result.messagesBefore,
            messageCountAfter: result.messagesAfter,
        });

        return result;
    }

    /**
     * Layer 3: 手动 compact（用户 / Agent 通过 /compact 触发）。
     * 与 auto_compact 逻辑相同但无阈值检查。
     */
    async forceCompact(summarizer: CompactSummarizer): Promise<CompactResult> {
        const tokensBefore = this.tokenTracker.tokens;
        const messagesBefore = this.messages.length;
        const messagesToIndex = [...this.messages];

        this.transcript?.logMessages(this.messages);

        const compacted = await autoCompact(this.messages, summarizer);
        const summary = getTextContent(compacted[0]);

        // 建立话题索引（用于后续回温）
        this.compactIndex.addEntry(messagesToIndex, summary);

        this.messages = compacted;
        this.refreshTokenCount();
        this.compactCount++;

        const result: CompactResult = {
            summary,
            tokensBefore,
            tokensAfter: this.tokenTracker.tokens,
            messagesBefore,
            messagesAfter: this.messages.length,
        };

        this.transcript?.logCompactEvent({
            beforeTokens: result.tokensBefore,
            afterTokens: result.tokensAfter,
            summary: result.summary,
            messageCountBefore: result.messagesBefore,
            messageCountAfter: result.messagesAfter,
        });

        return result;
    }

    /**
     * prepareForLLMCall — 在每次调 LLM 前调用。
     * 执行 micro_compact → 话题回温 → 组装最终消息。
     */
    prepareForLLMCall(): OpenAIMessage[] {
        this.runMicroCompact();

        // 话题回温：检查是否有被压缩的内容与当前对话相关
        const recallMessages = this.tryRecall();

        const withSystem: Message[] = [
            systemMessage(this.systemPrompt, true),
            ...recallMessages,
            ...this.messages,
        ];
        return toOpenAIMessages(withSystem);
    }

    /**
     * 话题回温：匹配当前输入与历史索引，恢复相关上下文。
     * 仅在存在历史索引时执行（即至少发生过一次压缩）。
     */
    private tryRecall(): Message[] {
        if (this.compactIndex.size === 0) {
            this.lastRecall = { recovered: false, tokensUsed: 0, sourceEntries: [], matchCount: 0, metamemoryHints: [] };
            return [];
        }

        // 从最近的 user 消息提取查询文本
        const lastUserMsg = [...this.messages].reverse().find(m => m.role === "user");
        const queryText = lastUserMsg ? getTextContent(lastUserMsg) : "";
        if (!queryText) {
            this.lastRecall = { recovered: false, tokensUsed: 0, sourceEntries: [], matchCount: 0, metamemoryHints: [] };
            return [];
        }

        // 匹配（含弱匹配，阈值降到 0.05 以捕获元认知区域）
        const allMatches = matchTopics(queryText, this.messages, this.compactIndex, { minScore: 0.05 });

        // 分离：强匹配（≥0.15 → 回温）vs 弱匹配（0.05-0.15 → 元认知提示）
        const strongMatches = allMatches.filter(m => m.score >= 0.15);
        const weakMatches = allMatches.filter(m => m.score >= 0.05 && m.score < 0.15);

        const result: Message[] = [];

        // 强匹配 → 完整回温
        if (strongMatches.length > 0) {
            const budget = Math.floor(this.tokenTracker.contextWindow * this.recallBudgetPercent);
            const recovery = recoverContext(strongMatches, budget);

            // Reconsolidation：强化被成功回温的索引
            const currentKeywords = extractKeywordsFromQuery(queryText);
            for (const entryId of recovery.sourceEntries) {
                this.compactIndex.reinforce(entryId, currentKeywords);
            }

            result.push(...recovery.recoveredMessages);

            this.lastRecall = {
                recovered: recovery.recoveredMessages.length > 0,
                tokensUsed: recovery.tokensUsed,
                sourceEntries: recovery.sourceEntries,
                matchCount: strongMatches.length,
                metamemoryHints: weakMatches.map(m => m.entry.summary.slice(0, 100)),
            };
        } else {
            this.lastRecall = {
                recovered: false,
                tokensUsed: 0,
                sourceEntries: [],
                matchCount: 0,
                metamemoryHints: weakMatches.map(m => m.entry.summary.slice(0, 100)),
            };
        }

        // 弱匹配 → 元认知提示（"你之前可能讨论过..."）
        if (weakMatches.length > 0 && strongMatches.length === 0) {
            const hints = weakMatches
                .slice(0, 3)
                .map(m => `• ${m.entry.summary.slice(0, 120)}`)
                .join("\n");

            result.push({
                role: "user" as const,
                content: [{
                    type: "text" as const,
                    text: `[Metamemory hint — you may have discussed related topics earlier, but details were compressed. Possibly relevant areas:\n${hints}\nIf the user's question relates to these, consider asking them to clarify or use /compact to check.]`,
                }],
                metadata: { compacted: true, timestamp: Date.now() },
            });
        }

        return result;
    }

    // ── 状态查询 ─────────────────────────────────────────────────

    get tokenCount(): number {
        return this.tokenTracker.tokens;
    }

    get utilizationPercent(): number {
        return this.tokenTracker.utilizationPercent;
    }

    get needsAutoCompact(): boolean {
        return this.tokenTracker.needsAutoCompact;
    }

    get messageCount(): number {
        return this.messages.length;
    }

    get compacts(): number {
        return this.compactCount;
    }

    getMessages(): readonly Message[] {
        return this.messages;
    }

    get fileFreshness(): FileFreshnessService {
        return this.freshness;
    }

    get recall(): RecallInfo {
        return this.lastRecall;
    }

    get indexedCompacts(): number {
        return this.compactIndex.size;
    }

    // ── Fork（子代理上下文隔离）────────────────────────────────────

    /**
     * 创建一个独立的子上下文。子代理拥有独立的消息列表、token 追踪、
     * compact 索引。不继承父级 transcript，可选继承或覆盖 systemPrompt。
     */
    fork(overrides?: Partial<ContextManagerConfig>): ContextManager {
        const config: ContextManagerConfig = {
            systemPrompt: overrides?.systemPrompt ?? this.systemPrompt,
            contextWindow: overrides?.contextWindow ?? this.tokenTracker.contextWindow,
            transcriptDir: overrides?.transcriptDir ?? null,
            recallBudgetPercent: overrides?.recallBudgetPercent ?? this.recallBudgetPercent,
        };
        return new ContextManager(config);
    }

    // ── 生命周期 ─────────────────────────────────────────────────

    close(): void {
        this.transcript?.logSessionEnd({
            totalMessages: this.messages.length,
            totalCompacts: this.compactCount,
            finalTokens: this.tokenTracker.tokens,
        });
        this.transcript?.close();
    }

    // ── 内部 ─────────────────────────────────────────────────────

    private refreshTokenCount(): void {
        const withSystem: Message[] = [
            systemMessage(this.systemPrompt),
            ...this.messages,
        ];
        this.tokenTracker.update(withSystem);
    }
}
