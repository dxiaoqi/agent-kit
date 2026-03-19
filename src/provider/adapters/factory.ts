// ── 适配器工厂 ───────────────────────────────────────────────────
// 根据 ProviderProfile.provider 字段自动选择适配器。
// 缓存已创建的适配器实例。

import type { ProviderAdapter, ProviderProfile } from "../types.js";
import { inferProvider } from "../capabilities.js";
import { OpenAIAdapter } from "./openai.js";
import { AnthropicAdapter } from "./anthropic.js";

const adapterCache = new Map<string, ProviderAdapter>();

export function getAdapter(profile: ProviderProfile): ProviderAdapter {
    const providerType = profile.provider || inferProvider(profile.name);

    if (adapterCache.has(providerType)) {
        return adapterCache.get(providerType)!;
    }

    const adapter = createAdapter(providerType);
    adapterCache.set(providerType, adapter);
    return adapter;
}

function createAdapter(providerType: string): ProviderAdapter {
    switch (providerType) {
        case "anthropic":
            return new AnthropicAdapter();
        case "openai":
        case "custom-openai":
        case "deepseek":
        case "gemini":
        default:
            return new OpenAIAdapter();
    }
}

export async function closeAllAdapters(): Promise<void> {
    for (const adapter of adapterCache.values()) {
        await adapter.close();
    }
    adapterCache.clear();
}
