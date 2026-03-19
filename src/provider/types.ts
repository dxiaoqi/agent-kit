// ── Provider 层公共类型 ──────────────────────────────────────────
// StreamEvent 使用 discriminated union：每种事件只携带自己需要的字段，
// 消灭旧版 7 个位置参数 + 大量 undefined 的问题。

// ── Token 计量 ────────────────────────────────────────────────────

export interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedTokens: number;
}

export function createTokenUsage(
    prompt = 0,
    completion = 0,
    total?: number,
    cached = 0,
): TokenUsage {
    return {
        promptTokens: prompt,
        completionTokens: completion,
        totalTokens: total ?? prompt + completion,
        cachedTokens: cached,
    };
}

export function addTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
    return {
        promptTokens: a.promptTokens + b.promptTokens,
        completionTokens: a.completionTokens + b.completionTokens,
        totalTokens: a.totalTokens + b.totalTokens,
        cachedTokens: a.cachedTokens + b.cachedTokens,
    };
}

// ── Tool Call ─────────────────────────────────────────────────────

export interface ToolCall {
    callId: string;
    name: string;
    args: Record<string, unknown>;
}

// ── Stream Events (discriminated union) ──────────────────────────

export type StreamEvent =
    | StreamEvent.TextDelta
    | StreamEvent.ToolCallStart
    | StreamEvent.ToolCallDelta
    | StreamEvent.ToolCallComplete
    | StreamEvent.MessageComplete
    | StreamEvent.Error;

export namespace StreamEvent {
    export interface TextDelta {
        type: "text_delta";
        text: string;
    }

    export interface ToolCallStart {
        type: "tool_call_start";
        callId: string;
        name: string;
    }

    export interface ToolCallDelta {
        type: "tool_call_delta";
        callId: string;
        argumentsDelta: string;
    }

    export interface ToolCallComplete {
        type: "tool_call_complete";
        toolCall: ToolCall;
    }

    export interface MessageComplete {
        type: "message_complete";
        finishReason: string;
        usage?: TokenUsage;
        toolCalls?: ToolCall[];
    }

    export interface Error {
        type: "error";
        error: string;
        retryable: boolean;
    }
}

// ── Provider Adapter 接口 ────────────────────────────────────────
// 具体实现（OpenAI / Anthropic）在 adapters/ 下，Phase 0.6 实现。

export interface ProviderAdapter {
    readonly name: string;

    chatCompletion(
        messages: readonly Record<string, unknown>[],
        tools: readonly ToolSchema[] | null,
        profile: ProviderProfile,
        signal?: AbortSignal,
    ): AsyncGenerator<StreamEvent>;

    close(): Promise<void>;
}

// ── Model Role ───────────────────────────────────────────────────
// 系统角色绑定：不同场景使用不同模型 profile。

export type ModelRole = "main" | "compact" | "subagent";

// ── Model Capabilities ──────────────────────────────────────────

export interface ModelCapabilities {
    functionCalling: boolean;
    vision: boolean;
    streaming: boolean;
    promptCaching: boolean;
    thinking: boolean;
}

export const defaultCapabilities: ModelCapabilities = {
    functionCalling: true,
    vision: false,
    streaming: true,
    promptCaching: false,
    thinking: false,
};

// ── Model Pricing (per million tokens) ──────────────────────────

export interface ModelPricing {
    inputPerMillion: number;
    outputPerMillion: number;
    cacheReadPerMillion?: number;
    cacheCreationPerMillion?: number;
}

// ── Provider Profile ────────────────────────────────────────────

export interface ProviderProfile {
    /** 模型标识名（如 gpt-4o, claude-sonnet-4-20250514） */
    name: string;
    /** profile ID（在 ModelRegistry 中使用） */
    id?: string;
    apiKey?: string;
    baseUrl?: string;
    temperature: number;
    contextWindow: number;
    maxTokens?: number;
    /** 提供商类型：openai | anthropic | custom-openai（默认 openai） */
    provider?: string;
    capabilities?: ModelCapabilities;
    pricing?: ModelPricing;
}

export interface ToolSchema {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

// ── 工厂函数：方便创建各种事件 ──────────────────────────────────

export const StreamEvents = {
    textDelta: (text: string): StreamEvent.TextDelta =>
        ({ type: "text_delta", text }),

    toolCallStart: (callId: string, name: string): StreamEvent.ToolCallStart =>
        ({ type: "tool_call_start", callId, name }),

    toolCallDelta: (callId: string, argumentsDelta: string): StreamEvent.ToolCallDelta =>
        ({ type: "tool_call_delta", callId, argumentsDelta }),

    toolCallComplete: (toolCall: ToolCall): StreamEvent.ToolCallComplete =>
        ({ type: "tool_call_complete", toolCall }),

    messageComplete: (finishReason: string, usage?: TokenUsage, toolCalls?: ToolCall[]): StreamEvent.MessageComplete =>
        ({ type: "message_complete", finishReason, usage, toolCalls }),

    error: (error: string, retryable = false): StreamEvent.Error =>
        ({ type: "error", error, retryable }),
} as const;
