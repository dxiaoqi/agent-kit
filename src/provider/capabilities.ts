// ── 模型能力检测 + 定价表 ────────────────────────────────────────
// 根据模型名自动推断 capabilities 和 pricing，
// 避免用户手动配置每个模型的细节。

import type { ModelCapabilities, ModelPricing } from "./types.js";
import { defaultCapabilities } from "./types.js";

// ── 已知模型的能力矩阵 ──────────────────────────────────────────

interface KnownModel {
    pattern: RegExp;
    capabilities: ModelCapabilities;
    pricing: ModelPricing;
}

const KNOWN_MODELS: KnownModel[] = [
    // ── Anthropic Claude 4 ──
    {
        pattern: /claude-4.*opus/i,
        capabilities: { functionCalling: true, vision: true, streaming: true, promptCaching: true, thinking: true },
        pricing: { inputPerMillion: 15, outputPerMillion: 75, cacheReadPerMillion: 1.5, cacheCreationPerMillion: 18.75 },
    },
    {
        pattern: /claude-4.*sonnet|claude-sonnet-4/i,
        capabilities: { functionCalling: true, vision: true, streaming: true, promptCaching: true, thinking: true },
        pricing: { inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3, cacheCreationPerMillion: 3.75 },
    },
    // ── Anthropic Claude 3.5 / 3.7 ──
    {
        pattern: /claude-3[.-]7|claude-3[.-]5.*sonnet/i,
        capabilities: { functionCalling: true, vision: true, streaming: true, promptCaching: true, thinking: true },
        pricing: { inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3, cacheCreationPerMillion: 3.75 },
    },
    {
        pattern: /claude-3[.-]5.*haiku/i,
        capabilities: { functionCalling: true, vision: true, streaming: true, promptCaching: true, thinking: false },
        pricing: { inputPerMillion: 0.8, outputPerMillion: 4, cacheReadPerMillion: 0.08, cacheCreationPerMillion: 1 },
    },
    // ── Anthropic Claude 3 ──
    {
        pattern: /claude-3.*opus/i,
        capabilities: { functionCalling: true, vision: true, streaming: true, promptCaching: true, thinking: false },
        pricing: { inputPerMillion: 15, outputPerMillion: 75, cacheReadPerMillion: 1.5, cacheCreationPerMillion: 18.75 },
    },
    {
        pattern: /claude-3.*sonnet/i,
        capabilities: { functionCalling: true, vision: true, streaming: true, promptCaching: true, thinking: false },
        pricing: { inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3, cacheCreationPerMillion: 3.75 },
    },
    {
        pattern: /claude-3.*haiku/i,
        capabilities: { functionCalling: true, vision: false, streaming: true, promptCaching: true, thinking: false },
        pricing: { inputPerMillion: 0.25, outputPerMillion: 1.25, cacheReadPerMillion: 0.03, cacheCreationPerMillion: 0.3 },
    },
    // ── OpenAI GPT-4o ──
    {
        pattern: /gpt-4o-mini/i,
        capabilities: { functionCalling: true, vision: true, streaming: true, promptCaching: false, thinking: false },
        pricing: { inputPerMillion: 0.15, outputPerMillion: 0.6 },
    },
    {
        pattern: /gpt-4o/i,
        capabilities: { functionCalling: true, vision: true, streaming: true, promptCaching: false, thinking: false },
        pricing: { inputPerMillion: 2.5, outputPerMillion: 10 },
    },
    // ── OpenAI o-series ──
    {
        pattern: /o[13]-mini/i,
        capabilities: { functionCalling: true, vision: false, streaming: true, promptCaching: false, thinking: true },
        pricing: { inputPerMillion: 1.1, outputPerMillion: 4.4 },
    },
    {
        pattern: /o[13]-pro/i,
        capabilities: { functionCalling: true, vision: true, streaming: true, promptCaching: false, thinking: true },
        pricing: { inputPerMillion: 20, outputPerMillion: 80 },
    },
    {
        pattern: /\bo[13]\b/i,
        capabilities: { functionCalling: true, vision: true, streaming: true, promptCaching: false, thinking: true },
        pricing: { inputPerMillion: 10, outputPerMillion: 40 },
    },
    // ── Google Gemini ──
    {
        pattern: /gemini-2[.-]5-flash/i,
        capabilities: { functionCalling: true, vision: true, streaming: true, promptCaching: false, thinking: true },
        pricing: { inputPerMillion: 0.15, outputPerMillion: 0.6 },
    },
    {
        pattern: /gemini-2[.-]5-pro/i,
        capabilities: { functionCalling: true, vision: true, streaming: true, promptCaching: false, thinking: true },
        pricing: { inputPerMillion: 1.25, outputPerMillion: 10 },
    },
    {
        pattern: /gemini-2[.-]0-flash/i,
        capabilities: { functionCalling: true, vision: true, streaming: true, promptCaching: false, thinking: false },
        pricing: { inputPerMillion: 0.1, outputPerMillion: 0.4 },
    },
    // ── DeepSeek ──
    {
        pattern: /deepseek-chat|deepseek-v3/i,
        capabilities: { functionCalling: true, vision: false, streaming: true, promptCaching: false, thinking: false },
        pricing: { inputPerMillion: 0.27, outputPerMillion: 1.1 },
    },
    {
        pattern: /deepseek-reasoner|deepseek-r1/i,
        capabilities: { functionCalling: false, vision: false, streaming: true, promptCaching: false, thinking: true },
        pricing: { inputPerMillion: 0.55, outputPerMillion: 2.19 },
    },
];

// ── 查询接口 ────────────────────────────────────────────────────

export function inferCapabilities(modelName: string): ModelCapabilities {
    for (const known of KNOWN_MODELS) {
        if (known.pattern.test(modelName)) {
            return { ...known.capabilities };
        }
    }
    return { ...defaultCapabilities };
}

export function inferPricing(modelName: string): ModelPricing | null {
    for (const known of KNOWN_MODELS) {
        if (known.pattern.test(modelName)) {
            return { ...known.pricing };
        }
    }
    return null;
}

/**
 * 检测 provider 类型：根据模型名自动推断
 */
export function inferProvider(modelName: string): string {
    if (/claude/i.test(modelName)) return "anthropic";
    if (/gpt|o[13]/i.test(modelName)) return "openai";
    if (/gemini/i.test(modelName)) return "openai";
    if (/deepseek/i.test(modelName)) return "openai";
    return "openai";
}
