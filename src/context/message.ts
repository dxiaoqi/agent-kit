// ── 内部中性消息格式 ─────────────────────────────────────────────
// 不绑定 OpenAI 也不绑定 Anthropic，表达两者的超集。
// 格式转换只在 Provider 适配器边界发生（toOpenAI / toAnthropic）。

// ── Content Blocks ───────────────────────────────────────────────

export type ContentBlock =
    | ContentBlock.Text
    | ContentBlock.ToolUse
    | ContentBlock.ToolResult
    | ContentBlock.Image
    | ContentBlock.Thinking;

export namespace ContentBlock {
    export interface Text {
        type: "text";
        text: string;
        cacheControl?: { type: "ephemeral" };
    }

    export interface ToolUse {
        type: "tool_use";
        id: string;
        name: string;
        input: Record<string, unknown>;
    }

    export interface ToolResult {
        type: "tool_result";
        toolUseId: string;
        content: string;
        isError?: boolean;
    }

    export interface Image {
        type: "image";
        mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
        data: string;
    }

    export interface Thinking {
        type: "thinking";
        text: string;
    }
}

// ── Message ──────────────────────────────────────────────────────

export type MessageRole = "system" | "user" | "assistant" | "tool_result";

export interface Message {
    role: MessageRole;
    content: ContentBlock[];
    metadata?: MessageMetadata;
}

/**
 * Salience level — models the amygdala's role in memory encoding.
 * Higher salience = stronger encoding = more resistant to compression.
 *
 * - critical: errors, user corrections, key architectural decisions
 * - high:     successful multi-step operations, TODO items, unresolved issues
 * - normal:   regular conversation turns
 * - low:      routine reads, acknowledgments, repetitive operations
 */
export type SalienceLevel = "critical" | "high" | "normal" | "low";

export interface MessageMetadata {
    timestamp?: number;
    turnIndex?: number;
    compacted?: boolean;
    salience?: SalienceLevel;
}

// ── 工厂函数 ─────────────────────────────────────────────────────

export function userMessage(text: string): Message {
    return { role: "user", content: [{ type: "text", text }] };
}

export function assistantMessage(text: string, toolUses?: ContentBlock.ToolUse[]): Message {
    const content: ContentBlock[] = [];
    if (text) content.push({ type: "text", text });
    if (toolUses) content.push(...toolUses);
    return { role: "assistant", content };
}

export function toolResultMessage(toolUseId: string, output: string, isError = false): Message {
    return {
        role: "tool_result",
        content: [{ type: "tool_result", toolUseId, content: output, isError }],
    };
}

export function systemMessage(text: string, cacheControl?: boolean): Message {
    return {
        role: "system",
        content: [{
            type: "text",
            text,
            ...(cacheControl ? { cacheControl: { type: "ephemeral" as const } } : {}),
        }],
    };
}

// ── 工具函数 ─────────────────────────────────────────────────────

export function getTextContent(message: Message): string {
    return message.content
        .filter((b): b is ContentBlock.Text => b.type === "text")
        .map(b => b.text)
        .join("");
}

export function getToolUses(message: Message): ContentBlock.ToolUse[] {
    return message.content.filter((b): b is ContentBlock.ToolUse => b.type === "tool_use");
}

export function getToolResults(message: Message): ContentBlock.ToolResult[] {
    return message.content.filter((b): b is ContentBlock.ToolResult => b.type === "tool_result");
}

// ── 格式转换：Message → OpenAI API 格式 ─────────────────────────

export interface OpenAIMessage {
    role: "system" | "user" | "assistant" | "tool";
    content: string | null;
    tool_calls?: OpenAIToolCall[];
    tool_call_id?: string;
    [key: string]: unknown;
}

interface OpenAIToolCall {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
}

export function toOpenAIMessages(messages: readonly Message[]): OpenAIMessage[] {
    const result: OpenAIMessage[] = [];

    for (const msg of messages) {
        switch (msg.role) {
            case "system":
                result.push({ role: "system", content: getTextContent(msg) });
                break;

            case "user":
                result.push({ role: "user", content: getTextContent(msg) });
                break;

            case "assistant": {
                const text = getTextContent(msg);
                const toolUses = getToolUses(msg);
                const oaiMsg: OpenAIMessage = {
                    role: "assistant",
                    content: text || null,
                };
                if (toolUses.length > 0) {
                    oaiMsg.tool_calls = toolUses.map(tu => ({
                        id: tu.id,
                        type: "function" as const,
                        function: {
                            name: tu.name,
                            arguments: JSON.stringify(tu.input),
                        },
                    }));
                }
                result.push(oaiMsg);
                break;
            }

            case "tool_result": {
                for (const block of getToolResults(msg)) {
                    result.push({
                        role: "tool",
                        content: block.content,
                        tool_call_id: block.toolUseId,
                    });
                }
                break;
            }
        }
    }

    return result;
}
