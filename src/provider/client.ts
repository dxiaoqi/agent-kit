// ── LLMClient ────────────────────────────────────────────────────
// 统一 LLM 调用入口：
// 1. 通过 ModelRegistry 按角色路由到正确的 profile
// 2. 通过 AdapterFactory 自动选择适配器（OpenAI / Anthropic）
// 3. 带重试/回退逻辑
// 4. 集成 CostTracker
// Agent 循环只和 LLMClient 交互，不直接使用适配器。

import type {
    ProviderAdapter,
    ProviderProfile,
    StreamEvent,
    ToolSchema,
    ModelRole,
} from "./types.js";
import { StreamEvents } from "./types.js";
import { classifyError, type AgentError } from "../kernel/errors.js";
import { ModelRegistry } from "./registry.js";
import { CostTracker } from "./cost.js";
import { getAdapter, closeAllAdapters } from "./adapters/factory.js";
import { inferPricing } from "./capabilities.js";

export interface LLMClientOptions {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
}

export class LLMClient {
    private readonly maxRetries: number;
    private readonly baseDelayMs: number;
    private readonly maxDelayMs: number;
    private readonly registry: ModelRegistry | null;
    private readonly costTracker: CostTracker;
    private legacyAdapter: ProviderAdapter | null;

    constructor(
        adapterOrRegistry: ProviderAdapter | ModelRegistry,
        options: LLMClientOptions = {},
        costTracker?: CostTracker,
    ) {
        this.maxRetries = options.maxRetries ?? 3;
        this.baseDelayMs = options.baseDelayMs ?? 500;
        this.maxDelayMs = options.maxDelayMs ?? 32_000;
        this.costTracker = costTracker ?? new CostTracker();

        if (adapterOrRegistry instanceof ModelRegistry) {
            this.registry = adapterOrRegistry;
            this.legacyAdapter = null;
        } else {
            this.registry = null;
            this.legacyAdapter = adapterOrRegistry;
        }
    }

    /**
     * 按角色路由调用（需要 ModelRegistry 构造）
     */
    async *chatForRole(
        role: ModelRole,
        messages: readonly Record<string, unknown>[],
        tools: readonly ToolSchema[] | null,
        signal?: AbortSignal,
    ): AsyncGenerator<StreamEvent> {
        if (!this.registry) {
            throw new Error("chatForRole requires LLMClient to be constructed with ModelRegistry");
        }
        const profile = this.registry.getForRole(role);
        yield* this.chat(messages, tools, profile, signal);
    }

    /**
     * 直接指定 profile 调用（兼容旧接口）
     */
    async *chat(
        messages: readonly Record<string, unknown>[],
        tools: readonly ToolSchema[] | null,
        profile: ProviderProfile,
        signal?: AbortSignal,
    ): AsyncGenerator<StreamEvent> {
        const adapter = this.legacyAdapter ?? getAdapter(profile);
        const startTime = Date.now();
        let lastError: AgentError | undefined;

        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                for await (const event of adapter.chatCompletion(messages, tools, profile, signal)) {
                    if (event.type === "message_complete" && event.usage) {
                        const pricing = profile.pricing ?? inferPricing(profile.name);
                        const duration = Date.now() - startTime;
                        this.costTracker.add(
                            profile.id ?? profile.name,
                            event.usage,
                            pricing,
                            duration,
                        );
                    }
                    yield event;
                }
                return;
            } catch (err) {
                lastError = classifyError(err);

                if (!lastError.isRetryable || attempt >= this.maxRetries) {
                    yield StreamEvents.error(lastError.message, lastError.isRetryable);
                    return;
                }

                const delay = lastError.retryAfterMs
                    ?? Math.min(this.baseDelayMs * Math.pow(2, attempt), this.maxDelayMs);
                await sleep(delay, signal);
            }
        }

        if (lastError) {
            yield StreamEvents.error(lastError.message, false);
        }
    }

    get providerName(): string {
        return this.legacyAdapter?.name ?? "multi-provider";
    }

    get costs(): CostTracker {
        return this.costTracker;
    }

    getRegistry(): ModelRegistry | null {
        return this.registry;
    }

    async close(): Promise<void> {
        if (this.legacyAdapter) {
            await this.legacyAdapter.close();
        } else {
            await closeAllAdapters();
        }
    }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(signal.reason); return; }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(signal.reason);
        }, { once: true });
    });
}
