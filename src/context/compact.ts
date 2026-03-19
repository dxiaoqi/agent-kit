// ── Context Compaction ────────────────────────────────────────────
// 两层压缩：micro_compact（静默裁剪）+ auto_compact（LLM 摘要）
//
// 认知模型对照：
// - micro_compact ≈ 感觉记忆衰变（仅保留注意力捕获的内容）
// - auto_compact  ≈ 海马体固化（情景记忆 → 语义记忆）
// - salience 保护 ≈ 杏仁核增强编码（高情绪/重要性 = 抗遗忘）

import type { Message, ContentBlock, SalienceLevel } from "./message.js";
import { estimateTokens } from "./token.js";

// ── Layer 1: micro_compact ──────────────────────────────────────
// 将 N 轮之前的 tool_result 内容替换为占位符，释放 token 空间。
// 改进：尊重 salience 标记，critical/high 消息免于裁剪。

const KEEP_RECENT_TOOL_RESULTS = 3;
const MIN_CONTENT_LENGTH = 200;

const PROTECTED_SALIENCE: Set<SalienceLevel> = new Set(["critical", "high"]);

export function microCompact(messages: Message[]): Message[] {
    const toolResultIndices: number[] = [];

    for (let i = 0; i < messages.length; i++) {
        if (messages[i].role === "tool_result") {
            toolResultIndices.push(i);
        }
    }

    if (toolResultIndices.length <= KEEP_RECENT_TOOL_RESULTS) {
        return messages;
    }

    const toTruncate = toolResultIndices.slice(0, -KEEP_RECENT_TOOL_RESULTS);

    return messages.map((msg, idx) => {
        if (!toTruncate.includes(idx)) return msg;

        // 杏仁核保护：高重要性消息免于裁剪
        const salience = msg.metadata?.salience;
        if (salience && PROTECTED_SALIENCE.has(salience)) return msg;

        const newContent = msg.content.map((block): ContentBlock => {
            if (block.type !== "tool_result") return block;
            if (block.content.length <= MIN_CONTENT_LENGTH) return block;

            const toolName = findToolNameForResult(messages, block.toolUseId);
            return {
                ...block,
                content: `[Previous result: ${toolName || "tool"} — ${estimateTokens(block.content)} tokens truncated]`,
            };
        });

        return {
            ...msg,
            content: newContent,
            metadata: { ...msg.metadata, compacted: true },
        };
    });
}

function findToolNameForResult(messages: readonly Message[], toolUseId: string): string | undefined {
    for (const msg of messages) {
        if (msg.role !== "assistant") continue;
        for (const block of msg.content) {
            if (block.type === "tool_use" && block.id === toolUseId) {
                return block.name;
            }
        }
    }
    return undefined;
}

// ── Layer 2: auto_compact ───────────────────────────────────────
// 调用 LLM 对整段对话生成摘要，替换所有消息。
// 原始消息保存到 TranscriptLogger（调用方负责）。

export interface CompactSummarizer {
    summarize(messages: readonly Message[]): Promise<string>;
}

export async function autoCompact(
    messages: Message[],
    summarizer: CompactSummarizer,
): Promise<Message[]> {
    const summary = await summarizer.summarize(messages);

    return [
        {
            role: "user" as const,
            content: [{ type: "text" as const, text: `[Context compressed]\n\n${summary}` }],
            metadata: { compacted: true, timestamp: Date.now() },
        },
        {
            role: "assistant" as const,
            content: [{ type: "text" as const, text: "Understood. I have the context summary and will continue from here." }],
            metadata: { compacted: true, timestamp: Date.now() },
        },
    ];
}

// ── compact 工具（用户 / Agent 主动触发） ─────────────────────────
// 与 auto_compact 相同的逻辑，但可以作为 Tool 注册供 Agent 使用

export async function manualCompact(
    messages: Message[],
    summarizer: CompactSummarizer,
): Promise<Message[]> {
    return autoCompact(messages, summarizer);
}
