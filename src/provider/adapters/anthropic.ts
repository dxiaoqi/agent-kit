// ── Anthropic 原生适配器 ─────────────────────────────────────────
// 实现 ProviderAdapter 接口，直接对接 Anthropic Messages API。
// 处理：system prompt 提取、tool schema 转换、streaming event 归一化、
//       prompt caching（cache_control）。
// 依赖 @anthropic-ai/sdk（可选安装）。

import type {
    ProviderAdapter,
    ProviderProfile,
    StreamEvent,
    ToolSchema,
    ToolCall,
} from "../types.js";
import { StreamEvents, createTokenUsage } from "../types.js";

export class AnthropicAdapter implements ProviderAdapter {
    readonly name = "anthropic";
    private client: any = null;
    private readonly clients = new Map<string, any>();

    private async getClient(profile: ProviderProfile): Promise<any> {
        const key = `${profile.baseUrl ?? "default"}::${profile.apiKey ?? ""}`;
        let client = this.clients.get(key);
        if (!client) {
            const Anthropic = await this.loadSDK();
            client = new Anthropic({
                apiKey: profile.apiKey,
                ...(profile.baseUrl ? { baseURL: profile.baseUrl } : {}),
            });
            this.clients.set(key, client);
        }
        return client;
    }

    private async loadSDK(): Promise<any> {
        try {
            // Dynamic import — @anthropic-ai/sdk is an optional peer dependency
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const mod = await (Function('return import("@anthropic-ai/sdk")')() as Promise<any>);
            return mod.default ?? mod;
        } catch {
            throw new Error(
                'Anthropic SDK not installed. Run: npm install @anthropic-ai/sdk\n' +
                'Or use provider = "openai" for OpenAI-compatible endpoints.',
            );
        }
    }

    async *chatCompletion(
        messages: readonly Record<string, unknown>[],
        tools: readonly ToolSchema[] | null,
        profile: ProviderProfile,
        signal?: AbortSignal,
    ): AsyncGenerator<StreamEvent> {
        const client = await this.getClient(profile);

        const { systemBlocks, apiMessages } = this.convertMessages(messages);
        const enableCache = profile.capabilities?.promptCaching ?? false;

        const params: Record<string, unknown> = {
            model: profile.name,
            max_tokens: profile.maxTokens ?? 8192,
            messages: apiMessages,
            stream: true,
        };

        if (systemBlocks.length > 0) {
            if (enableCache) {
                const last = systemBlocks[systemBlocks.length - 1];
                systemBlocks[systemBlocks.length - 1] = {
                    ...last,
                    cache_control: { type: "ephemeral" },
                };
            }
            params.system = systemBlocks;
        }

        if (profile.temperature !== undefined) {
            params.temperature = profile.temperature;
        }

        if (tools && tools.length > 0) {
            params.tools = tools.map(t => ({
                name: t.name,
                description: t.description,
                input_schema: t.parameters,
            }));
        }

        const stream = client.messages.stream(params, signal ? { signal } : undefined);

        let currentToolId = "";
        let currentToolName = "";
        let currentToolArgs = "";
        const completedTools: ToolCall[] = [];
        let finishReason = "end_turn";

        for await (const event of stream) {
            switch (event.type) {
                case "content_block_start": {
                    const block = event.content_block;
                    if (block.type === "tool_use") {
                        currentToolId = block.id;
                        currentToolName = block.name;
                        currentToolArgs = "";
                        yield StreamEvents.toolCallStart(currentToolId, currentToolName);
                    }
                    break;
                }

                case "content_block_delta": {
                    const delta = event.delta;
                    if (delta.type === "text_delta") {
                        yield StreamEvents.textDelta(delta.text);
                    } else if (delta.type === "input_json_delta") {
                        currentToolArgs += delta.partial_json;
                        yield StreamEvents.toolCallDelta(currentToolId, delta.partial_json);
                    }
                    break;
                }

                case "content_block_stop": {
                    if (currentToolId && currentToolName) {
                        const toolCall: ToolCall = {
                            callId: currentToolId,
                            name: currentToolName,
                            args: safeJsonParse(currentToolArgs),
                        };
                        completedTools.push(toolCall);
                        yield StreamEvents.toolCallComplete(toolCall);
                        currentToolId = "";
                        currentToolName = "";
                        currentToolArgs = "";
                    }
                    break;
                }

                case "message_delta": {
                    if (event.delta?.stop_reason) {
                        finishReason = this.mapStopReason(event.delta.stop_reason);
                    }
                    break;
                }

                case "message_stop": {
                    break;
                }
            }
        }

        const finalMessage = await stream.finalMessage();
        const usage = createTokenUsage(
            finalMessage.usage?.input_tokens ?? 0,
            finalMessage.usage?.output_tokens ?? 0,
            undefined,
            (finalMessage.usage as any)?.cache_read_input_tokens ?? 0,
        );

        yield StreamEvents.messageComplete(
            finishReason,
            usage,
            completedTools.length > 0 ? completedTools : undefined,
        );
    }

    // ── 消息格式转换 ────────────────────────────────────────────

    private convertMessages(
        messages: readonly Record<string, unknown>[],
    ): { systemBlocks: Record<string, unknown>[]; apiMessages: Record<string, unknown>[] } {
        const systemBlocks: Record<string, unknown>[] = [];
        const apiMessages: Record<string, unknown>[] = [];

        for (const msg of messages) {
            if (msg.role === "system") {
                const text = typeof msg.content === "string"
                    ? msg.content
                    : Array.isArray(msg.content)
                        ? (msg.content as any[]).map(b => (b as any).text ?? "").join("\n")
                        : String(msg.content);
                systemBlocks.push({ type: "text", text });
                continue;
            }

            if (msg.role === "tool") {
                apiMessages.push({
                    role: "user",
                    content: [{
                        type: "tool_result",
                        tool_use_id: msg.tool_call_id,
                        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
                    }],
                });
                continue;
            }

            if (msg.role === "assistant") {
                const content: unknown[] = [];

                if (typeof msg.content === "string" && msg.content) {
                    content.push({ type: "text", text: msg.content });
                }

                if (Array.isArray(msg.tool_calls)) {
                    for (const tc of msg.tool_calls as any[]) {
                        content.push({
                            type: "tool_use",
                            id: tc.id,
                            name: tc.function?.name ?? tc.name,
                            input: typeof tc.function?.arguments === "string"
                                ? safeJsonParse(tc.function.arguments)
                                : tc.args ?? tc.function?.arguments ?? {},
                        });
                    }
                }

                if (content.length > 0) {
                    apiMessages.push({ role: "assistant", content });
                }
                continue;
            }

            // user messages pass through
            apiMessages.push({
                role: "user",
                content: typeof msg.content === "string"
                    ? msg.content
                    : msg.content,
            });
        }

        return { systemBlocks, apiMessages };
    }

    private mapStopReason(reason: string): string {
        switch (reason) {
            case "tool_use": return "tool_calls";
            case "max_tokens": return "length";
            case "end_turn": return "stop";
            default: return reason;
        }
    }

    async close(): Promise<void> {
        this.clients.clear();
    }
}

function safeJsonParse(raw: string): Record<string, unknown> {
    try {
        return JSON.parse(raw || "{}");
    } catch {
        return {};
    }
}
