// ── CostTracker：成本追踪器 ──────────────────────────────────────
// 按模型累计 token 用量和费用，支持分模型统计和格式化输出。

import type { TokenUsage, ModelPricing } from "./types.js";
import { addTokenUsage, createTokenUsage } from "./types.js";

export interface CostEntry {
    modelId: string;
    usage: TokenUsage;
    costUSD: number;
    durationMs: number;
    timestamp: number;
}

export interface CostSummary {
    totalCostUSD: number;
    totalApiDurationMs: number;
    wallDurationMs: number;
    totalUsage: TokenUsage;
    perModel: Record<string, { usage: TokenUsage; costUSD: number; calls: number }>;
}

export class CostTracker {
    private readonly entries: CostEntry[] = [];
    private readonly perModelUsage = new Map<string, { usage: TokenUsage; costUSD: number; calls: number }>();
    private totalCost = 0;
    private totalApiDuration = 0;
    private totalUsage: TokenUsage = createTokenUsage();
    private readonly startTime = Date.now();

    add(modelId: string, usage: TokenUsage, pricing: ModelPricing | null, durationMs: number): void {
        const cost = pricing ? this.calculateCost(usage, pricing) : 0;

        this.entries.push({
            modelId,
            usage,
            costUSD: cost,
            durationMs,
            timestamp: Date.now(),
        });

        this.totalCost += cost;
        this.totalApiDuration += durationMs;
        this.totalUsage = addTokenUsage(this.totalUsage, usage);

        const existing = this.perModelUsage.get(modelId);
        if (existing) {
            existing.usage = addTokenUsage(existing.usage, usage);
            existing.costUSD += cost;
            existing.calls += 1;
        } else {
            this.perModelUsage.set(modelId, { usage: { ...usage }, costUSD: cost, calls: 1 });
        }
    }

    private calculateCost(usage: TokenUsage, pricing: ModelPricing): number {
        return (
            (usage.promptTokens / 1_000_000) * pricing.inputPerMillion +
            (usage.completionTokens / 1_000_000) * pricing.outputPerMillion +
            (usage.cachedTokens / 1_000_000) * (pricing.cacheReadPerMillion ?? 0)
        );
    }

    getSummary(): CostSummary {
        return {
            totalCostUSD: this.totalCost,
            totalApiDurationMs: this.totalApiDuration,
            wallDurationMs: Date.now() - this.startTime,
            totalUsage: { ...this.totalUsage },
            perModel: Object.fromEntries(
                Array.from(this.perModelUsage.entries()).map(
                    ([id, data]) => [id, { ...data, usage: { ...data.usage } }],
                ),
            ),
        };
    }

    get cost(): number {
        return this.totalCost;
    }

    get apiDuration(): number {
        return this.totalApiDuration;
    }

    get usage(): TokenUsage {
        return this.totalUsage;
    }

    format(): string {
        const parts: string[] = [];

        if (this.totalCost > 0) {
            parts.push(`$${this.totalCost.toFixed(4)}`);
        }

        const u = this.totalUsage;
        parts.push(`${formatTokens(u.totalTokens)} tokens`);

        if (u.cachedTokens > 0) {
            parts.push(`${formatTokens(u.cachedTokens)} cached`);
        }

        parts.push(`${(this.totalApiDuration / 1000).toFixed(1)}s API`);
        parts.push(`${((Date.now() - this.startTime) / 1000).toFixed(1)}s wall`);

        return parts.join(" | ");
    }

    formatDetailed(): string {
        const lines: string[] = [`Session Cost Summary`, `${"─".repeat(50)}`];

        lines.push(`Total: $${this.totalCost.toFixed(4)}`);
        lines.push(`API time: ${(this.totalApiDuration / 1000).toFixed(1)}s`);
        lines.push(`Wall time: ${((Date.now() - this.startTime) / 1000).toFixed(1)}s`);
        lines.push(`Total tokens: ${formatTokens(this.totalUsage.totalTokens)}`);

        if (this.perModelUsage.size > 1) {
            lines.push(`\nPer Model:`);
            for (const [id, data] of this.perModelUsage) {
                lines.push(`  ${id}: $${data.costUSD.toFixed(4)} (${data.calls} calls, ${formatTokens(data.usage.totalTokens)} tokens)`);
            }
        }

        return lines.join("\n");
    }

    reset(): void {
        this.entries.length = 0;
        this.perModelUsage.clear();
        this.totalCost = 0;
        this.totalApiDuration = 0;
        this.totalUsage = createTokenUsage();
    }
}

function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
}
