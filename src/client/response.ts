export enum StreamEventType {
  TEXT_DELTA         = "text_delta",
  TOOL_CALL_START    = "tool_call_start",
  TOOL_CALL_DELTA    = "tool_call_delta",
  TOOL_CALL_COMPLETE = "tool_call_complete",
  MESSAGE_COMPLETE   = "message_complete",
  ERROR              = "error",
}

export class TextDelta {
  constructor(public readonly text: string) {}
}

export class ToolCallDelta {
  constructor(
    public readonly callId: string,
    public readonly name: string,
    public readonly argumentsDelta?: string
  ) {}
}

export class ToolCall {
  constructor(
    public readonly callId: string,
    public readonly name: string,
    public readonly args: Record<string, any>
  ) {}
}

export class TokenUsage {
  constructor(
    public readonly promptTokens:     number,
    public readonly completionTokens: number,
    public readonly totalTokens:      number,
    public readonly cachedTokens:     number = 0
  ) {}

  add(other: TokenUsage): TokenUsage {
    return new TokenUsage(
      this.promptTokens     + other.promptTokens,
      this.completionTokens + other.completionTokens,
      this.totalTokens      + other.totalTokens,
      this.cachedTokens     + other.cachedTokens
    );
  }
}

export class StreamEvent {
  constructor(
    public readonly type:          StreamEventType,
    public readonly textDelta?:    TextDelta,
    public readonly error?:        string,
    public readonly finishReason?: string,
    public readonly toolCallDelta?: ToolCallDelta,
    public readonly toolCall?:     ToolCall,
    public readonly usage?:        TokenUsage,
    public readonly toolCalls?:    ToolCall[]
  ) {}
}

export function parseToolCallArguments(raw: string): Record<string, any> {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}
