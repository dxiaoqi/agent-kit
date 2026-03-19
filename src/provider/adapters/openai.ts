// ── OpenAI 兼容适配器 ────────────────────────────────────────────
// 从旧 src/client/llm_client.ts 拆分而来。
// 实现 ProviderAdapter 接口，支持所有 OpenAI-compatible API。

import OpenAI from "openai";
import type {
    ProviderAdapter,
    ProviderProfile,
    StreamEvent,
    ToolSchema,
    TokenUsage,
    ToolCall,
} from "../types.js";
import { StreamEvents, createTokenUsage } from "../types.js";

export class OpenAIAdapter implements ProviderAdapter {
    readonly name = "openai";
    private readonly clients = new Map<string, OpenAI>();

    private getClient(profile: ProviderProfile): OpenAI {
        const key = `${profile.baseUrl ?? "default"}::${profile.apiKey ?? ""}`;
        let client = this.clients.get(key);
        if (!client) {
            client = new OpenAI({ apiKey: profile.apiKey, baseURL: profile.baseUrl });
            this.clients.set(key, client);
        }
        return client;
    }

    async *chatCompletion(
        messages: readonly Record<string, unknown>[],
        tools: readonly ToolSchema[] | null,
        profile: ProviderProfile,
        signal?: AbortSignal,
    ): AsyncGenerator<StreamEvent> {
        const client = this.getClient(profile);

        const params: Record<string, unknown> = {
            model: profile.name,
            messages,
            stream: true,
            stream_options: { include_usage: true },
            temperature: profile.temperature,
        };
        if (profile.maxTokens) params.max_tokens = profile.maxTokens;
        if (tools && tools.length > 0) {
            params.tools = tools.map(t => ({
                type: "function",
                function: { name: t.name, description: t.description, parameters: t.parameters },
            }));
            params.tool_choice = "auto";
        }

        const stream = await client.chat.completions.create(
            params as any,
            signal ? { signal } : undefined,
        ) as any;

        const accum = new Map<number, { id: string; name: string; arguments: string }>();
        let finishReason = "stop";
        let usage: TokenUsage | undefined;

        for await (const chunk of stream) {
            // Usage（stream_options: include_usage）
            if (chunk.usage) {
                usage = createTokenUsage(
                    chunk.usage.prompt_tokens,
                    chunk.usage.completion_tokens,
                    chunk.usage.total_tokens,
                    chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
                );
            }
            if (!chunk.choices?.length) continue;

            const choice = chunk.choices[0];
            if (choice.finish_reason) finishReason = choice.finish_reason;
            const delta = choice.delta;

            // 文本流
            if (delta.content) {
                yield StreamEvents.textDelta(delta.content);
            }

            // 工具调用流
            if (delta.tool_calls) {
                for (const tcd of delta.tool_calls) {
                    const idx = tcd.index as number;
                    if (!accum.has(idx)) {
                        accum.set(idx, { id: tcd.id ?? "", name: tcd.function?.name ?? "", arguments: "" });
                        if (tcd.id && tcd.function?.name) {
                            yield StreamEvents.toolCallStart(tcd.id, tcd.function.name);
                        }
                    }
                    const tc = accum.get(idx)!;
                    if (tcd.function?.name && !tc.name) tc.name = tcd.function.name;
                    if (tcd.function?.arguments) {
                        tc.arguments += tcd.function.arguments;
                        yield StreamEvents.toolCallDelta(tc.id, tcd.function.arguments);
                    }
                }
            }
        }

        // 流结束：发射完整的 tool call 事件
        const toolCalls: ToolCall[] = [];
        for (const [, tc] of accum) {
            const toolCall: ToolCall = {
                callId: tc.id,
                name: tc.name,
                args: safeJsonParse(tc.arguments),
            };
            toolCalls.push(toolCall);
            yield StreamEvents.toolCallComplete(toolCall);
        }

        yield StreamEvents.messageComplete(
            finishReason,
            usage,
            toolCalls.length > 0 ? toolCalls : undefined,
        );
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
