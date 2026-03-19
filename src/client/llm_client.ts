import OpenAI from "openai";
import { ModelProfile } from "../config/config.js";
import {
  StreamEvent,
  StreamEventType,
  TextDelta,
  TokenUsage,
  ToolCall,
  parseToolCallArguments,
} from "./response.js";

export interface ToolSchema {
  name:        string;
  description: string;
  parameters:  Record<string, any>;
}

/**
 * Stateless OpenAI-compatible streaming client.
 * A single client instance is shared; OpenAI SDK instances are cached by baseUrl+apiKey.
 */
export class LLMClient {
  private readonly clients: Map<string, OpenAI> = new Map();
  private readonly maxRetries = 3;

  private getClient(profile: ModelProfile): OpenAI {
    const key = `${profile.baseUrl ?? "default"}::${profile.apiKey ?? ""}`;
    if (!this.clients.has(key)) {
      this.clients.set(
        key,
        new OpenAI({ apiKey: profile.apiKey, baseURL: profile.baseUrl })
      );
    }
    return this.clients.get(key)!;
  }

  async *chatCompletion(
    messages:  Array<Record<string, any>>,
    tools:     ToolSchema[] | null,
    profile:   ModelProfile,
    stream = true
  ): AsyncGenerator<StreamEvent> {
    const client = this.getClient(profile);

    const kwargs: any = {
      model:       profile.name,
      messages,
      stream,
      temperature: profile.temperature,
    };
    if (profile.maxTokens)          kwargs.max_tokens  = profile.maxTokens;
    if (tools && tools.length > 0) {
      kwargs.tools = tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      kwargs.tool_choice = "auto";
    }

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        if (stream) {
          yield* this.streamResponse(client, kwargs);
        } else {
          yield await this.nonStreamResponse(client, kwargs);
        }
        return;
      } catch (err: any) {
        const retryable = err.status === 429 || err.type === "connection_error";
        if (retryable && attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
        } else {
          yield new StreamEvent(
            StreamEventType.ERROR,
            undefined,
            `API error: ${err.message ?? err}`
          );
          return;
        }
      }
    }
  }

  private async *streamResponse(
    client: OpenAI,
    kwargs: any
  ): AsyncGenerator<StreamEvent> {
    const stream = (await client.chat.completions.create(kwargs)) as any;
    const accum: Map<number, { id: string; name: string; arguments: string }> = new Map();
    let finishReason: string | undefined;
    let usage: TokenUsage | undefined;

    for await (const chunk of stream) {
      if (chunk.usage) {
        usage = new TokenUsage(
          chunk.usage.prompt_tokens,
          chunk.usage.completion_tokens,
          chunk.usage.total_tokens,
          chunk.usage.prompt_tokens_details?.cached_tokens ?? 0
        );
      }
      if (!chunk.choices?.length) continue;

      const choice = chunk.choices[0];
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta;

      if (delta.content) {
        yield new StreamEvent(StreamEventType.TEXT_DELTA, new TextDelta(delta.content));
      }

      if (delta.tool_calls) {
        for (const tcd of delta.tool_calls) {
          const idx = tcd.index as number;
          if (!accum.has(idx)) {
            accum.set(idx, { id: tcd.id ?? "", name: tcd.function?.name ?? "", arguments: "" });
          }
          const tc = accum.get(idx)!;
          if (tcd.function?.name && !tc.name) tc.name = tcd.function.name;
          if (tcd.function?.arguments)        tc.arguments += tcd.function.arguments;
        }
      }
    }

    for (const [, tc] of accum) {
      yield new StreamEvent(
        StreamEventType.TOOL_CALL_COMPLETE,
        undefined, undefined, undefined, undefined,
        new ToolCall(tc.id, tc.name, parseToolCallArguments(tc.arguments))
      );
    }

    yield new StreamEvent(
      StreamEventType.MESSAGE_COMPLETE,
      undefined, undefined, finishReason,
      undefined, undefined, usage
    );
  }

  private async nonStreamResponse(client: OpenAI, kwargs: any): Promise<StreamEvent> {
    const response = await client.chat.completions.create({ ...kwargs, stream: false });
    const choice   = response.choices[0];
    const message  = choice.message;

    const toolCalls = (message.tool_calls ?? []).map(
      (tc) => new ToolCall(tc.id, tc.function.name, parseToolCallArguments(tc.function.arguments))
    );

    const usage = response.usage
      ? new TokenUsage(
          response.usage.prompt_tokens,
          response.usage.completion_tokens,
          response.usage.total_tokens
        )
      : undefined;

    return new StreamEvent(
      StreamEventType.MESSAGE_COMPLETE,
      message.content ? new TextDelta(message.content) : undefined,
      undefined,
      choice.finish_reason ?? undefined,
      undefined, undefined,
      usage,
      toolCalls
    );
  }

  async close(): Promise<void> {
    this.clients.clear();
  }
}
