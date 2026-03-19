// ── LLMSummarizer ───────────────────────────────────────────────
// 使用 LLMClient 对对话历史生成摘要，实现 CompactSummarizer 接口。
// 改进：识别高重要性内容，在摘要 prompt 中显式标注要求优先保留。

import type { CompactSummarizer } from "./compact.js";
import type { Message, SalienceLevel } from "./message.js";
import { getTextContent, toOpenAIMessages, systemMessage, userMessage } from "./message.js";
import type { LLMClient } from "../provider/client.js";
import type { ProviderProfile } from "../provider/types.js";

const COMPACT_SYSTEM_PROMPT = `You are a conversation summarizer. Your task is to create a concise but comprehensive summary of the conversation so far.

Rules:
- Capture ALL key decisions, code changes, file paths, and technical details
- Preserve any TODO items, pending tasks, or unresolved issues
- Keep file paths, function names, and variable names exact (do not paraphrase)
- Note the current state of any ongoing work
- Be concise but don't lose important information
- Output the summary in the same language as the conversation
- Format as structured bullet points

CRITICAL — Messages marked [CRITICAL] or [HIGH IMPORTANCE] contain errors, user corrections, key decisions, or pending tasks. These MUST be preserved with full detail in the summary. Never summarize them into vague descriptions.`;

const SALIENCE_LABEL: Record<SalienceLevel, string> = {
    critical: "[CRITICAL]",
    high: "[HIGH IMPORTANCE]",
    normal: "",
    low: "[low priority]",
};

export class LLMSummarizer implements CompactSummarizer {
    constructor(
        private readonly llm: LLMClient,
        private readonly profile: ProviderProfile,
    ) {}

    async summarize(messages: readonly Message[]): Promise<string> {
        const conversationText = messages
            .map(msg => {
                const text = getTextContent(msg);
                const label = SALIENCE_LABEL[msg.metadata?.salience ?? "normal"];
                const prefix = label ? `${label} ` : "";
                return `${prefix}[${msg.role}]: ${text}`;
            })
            .filter(line => line.length > 10)
            .join("\n\n");

        const summaryMessages = toOpenAIMessages([
            systemMessage(COMPACT_SYSTEM_PROMPT),
            userMessage(`Please summarize this conversation:\n\n${conversationText}`),
        ]);

        let result = "";
        for await (const event of this.llm.chat(summaryMessages, null, this.profile)) {
            if (event.type === "text_delta") {
                result += event.text;
            }
        }

        return result || "[Summary generation failed — no content returned]";
    }
}
