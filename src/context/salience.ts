// ── Salience Detection（重要性检测 — 杏仁核模型）────────────────
// 自动为消息标记重要性等级，影响压缩保护和回温优先级。
//
// 认知科学基础：
// - 杏仁核对情绪显著事件（错误、惊喜、冲突）的编码增强效应
// - 自我参照效应：涉及用户明确指令的内容记忆更深
// - 冯·雷斯托夫效应：与众不同的事件更容易被记住

import type { Message, SalienceLevel } from "./message.js";
import { getTextContent, getToolUses, getToolResults } from "./message.js";

// ── 信号检测器 ──────────────────────────────────────────────────

interface SalienceSignal {
    level: SalienceLevel;
    weight: number;
    reason: string;
}

const ERROR_PATTERNS = [
    /error/i, /fail(ed|ure)?/i, /exception/i, /crash/i, /bug/i,
    /broken/i, /wrong/i, /incorrect/i, /invalid/i,
    /cannot|can't|couldn't/i, /undefined is not/i,
    /TypeError|ReferenceError|SyntaxError/i,
    /错误/, /失败/, /异常/, /崩溃/,
];

const CORRECTION_PATTERNS = [
    /不对|不是|不要|应该是|而不是|改成|修改为/,
    /no,?\s+(that's|it's|this is)\s+(wrong|incorrect|not)/i,
    /actually|instead|rather|correct(ion)?/i,
    /please (change|fix|update|modify|undo|revert)/i,
    /I (meant|want|need)/i,
];

const DECISION_PATTERNS = [
    /决定|选择|方案|架构|设计|策略/,
    /let'?s? (go with|use|choose|decide)/i,
    /the (plan|approach|strategy|architecture) (is|will be)/i,
    /we('ll| will| should) (use|adopt|implement)/i,
    /important|critical|key (decision|point)/i,
];

const TODO_PATTERNS = [
    /TODO|FIXME|HACK|待办|下一步|接下来/,
    /need(s?) to|should|must|have to/i,
    /remaining|pending|left to do/i,
    /还需要|还没有|尚未/,
];

/**
 * 检测单条消息的重要性等级。
 * 综合多个信号，取最高权重的等级。
 */
export function detectSalience(msg: Message): SalienceLevel {
    const signals: SalienceSignal[] = [];
    const text = getTextContent(msg);
    const toolResults = getToolResults(msg);
    const toolUses = getToolUses(msg);

    // 用户纠正 → critical（自我参照 + 错误信号）
    if (msg.role === "user") {
        for (const pattern of CORRECTION_PATTERNS) {
            if (pattern.test(text)) {
                signals.push({ level: "critical", weight: 10, reason: "user_correction" });
                break;
            }
        }
    }

    // 工具执行错误 → critical
    for (const tr of toolResults) {
        if (tr.isError) {
            signals.push({ level: "critical", weight: 9, reason: "tool_error" });
            break;
        }
    }

    // 文本中的错误信号 → critical
    for (const pattern of ERROR_PATTERNS) {
        if (pattern.test(text)) {
            signals.push({ level: "critical", weight: 8, reason: "error_mention" });
            break;
        }
    }

    // 架构/设计决策 → high
    for (const pattern of DECISION_PATTERNS) {
        if (pattern.test(text)) {
            signals.push({ level: "high", weight: 6, reason: "decision" });
            break;
        }
    }

    // TODO / 待办项 → high（前瞻性记忆）
    for (const pattern of TODO_PATTERNS) {
        if (pattern.test(text)) {
            signals.push({ level: "high", weight: 5, reason: "todo_item" });
            break;
        }
    }

    // 写操作 → high（深加工 = 深编码）
    for (const tu of toolUses) {
        if (tu.name === "write_file" || tu.name === "edit_file") {
            signals.push({ level: "high", weight: 4, reason: "write_operation" });
            break;
        }
    }

    // 多工具调用 → high（复杂操作组块）
    if (toolUses.length >= 3) {
        signals.push({ level: "high", weight: 3, reason: "multi_tool_chunk" });
    }

    // 短消息 / 确认 → low
    if (text.length < 30 && !signals.some(s => s.weight >= 5)) {
        signals.push({ level: "low", weight: 1, reason: "brief_message" });
    }

    // 纯读操作 → low
    if (toolUses.length === 1 && toolUses[0].name === "read_file" && toolResults.length === 0) {
        signals.push({ level: "low", weight: 1, reason: "passive_read" });
    }

    if (signals.length === 0) return "normal";

    signals.sort((a, b) => b.weight - a.weight);
    return signals[0].level;
}

/**
 * 批量为消息标记重要性（不修改原消息，返回新数组）。
 */
export function tagSalience(messages: Message[]): Message[] {
    return messages.map(msg => {
        if (msg.metadata?.salience) return msg;
        return {
            ...msg,
            metadata: {
                ...msg.metadata,
                salience: detectSalience(msg),
            },
        };
    });
}

// ── Salience 权重（供压缩和回温决策使用）──────────────────────────

const SALIENCE_WEIGHTS: Record<SalienceLevel, number> = {
    critical: 4.0,
    high: 2.0,
    normal: 1.0,
    low: 0.5,
};

export function salienceWeight(level: SalienceLevel): number {
    return SALIENCE_WEIGHTS[level];
}

/**
 * 计算消息的综合重要性分数（用于压缩排序）。
 * 结合重要性等级和时间衰减。
 */
export function messageImportance(msg: Message, now: number): number {
    const salience = msg.metadata?.salience ?? "normal";
    const weight = salienceWeight(salience);
    const age = now - (msg.metadata?.timestamp ?? now);
    const ageMinutes = age / 60_000;
    const timeDecay = Math.pow(0.5, ageMinutes / 60); // 60 分钟半衰期
    return weight * (0.4 + 0.6 * timeDecay);
}
