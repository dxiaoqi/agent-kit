// ── TokenTracker ─────────────────────────────────────────────────
// Token 计数与阈值管理。
// 使用简易估算（字符数 / 4）作为默认策略，可替换为 tiktoken。

import type { Message, ContentBlock } from "./message.js";

// ── 估算函数 ─────────────────────────────────────────────────────

export function estimateTokens(text: string): number {
    // 粗估：1 token ≈ 4 字符（英文），中文更高但作为安全上限够用
    return Math.ceil(text.length / 4);
}

export function estimateMessageTokens(msg: Message): number {
    let count = 4; // role + structural overhead
    for (const block of msg.content) {
        switch (block.type) {
            case "text":
                count += estimateTokens(block.text);
                break;
            case "tool_use":
                count += estimateTokens(block.name) + estimateTokens(JSON.stringify(block.input));
                break;
            case "tool_result":
                count += estimateTokens(block.content);
                break;
            case "thinking":
                count += estimateTokens(block.text);
                break;
            case "image":
                count += 1000; // 图片 token 估算
                break;
        }
    }
    return count;
}

export function estimateMessagesTokens(messages: readonly Message[]): number {
    return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

// ── TokenTracker ─────────────────────────────────────────────────

export interface TokenThresholds {
    /** context window 总大小 */
    contextWindow: number;
    /** micro_compact 触发阈值（默认 contextWindow 的 60%） */
    microCompactAt: number;
    /** auto_compact 触发阈值（默认 contextWindow 的 80%） */
    autoCompactAt: number;
    /** 压缩后目标 token 数（默认 contextWindow 的 40%） */
    compactTarget: number;
}

export function createThresholds(contextWindow: number): TokenThresholds {
    return {
        contextWindow,
        microCompactAt: Math.floor(contextWindow * 0.6),
        autoCompactAt: Math.floor(contextWindow * 0.8),
        compactTarget: Math.floor(contextWindow * 0.4),
    };
}

export class TokenTracker {
    private readonly thresholds: TokenThresholds;
    private currentTokens = 0;

    constructor(contextWindow: number) {
        this.thresholds = createThresholds(contextWindow);
    }

    update(messages: readonly Message[]): void {
        this.currentTokens = estimateMessagesTokens(messages);
    }

    get tokens(): number {
        return this.currentTokens;
    }

    get needsMicroCompact(): boolean {
        return this.currentTokens >= this.thresholds.microCompactAt;
    }

    get needsAutoCompact(): boolean {
        return this.currentTokens >= this.thresholds.autoCompactAt;
    }

    get compactTarget(): number {
        return this.thresholds.compactTarget;
    }

    get contextWindow(): number {
        return this.thresholds.contextWindow;
    }

    get utilizationPercent(): number {
        return Math.round((this.currentTokens / this.thresholds.contextWindow) * 100);
    }
}
