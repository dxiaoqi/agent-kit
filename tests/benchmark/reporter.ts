// ── 报告器 ─────────────────────────────────────────────────────
// 将基准测试结果格式化为多种输出格式

import type { BenchmarkReport, MemoryCategory, ScenarioResult, CheckpointResult } from "./protocol.js";

// ── 终端表格输出 ────────────────────────────────────────────────

const CATEGORY_LABELS: Record<MemoryCategory, string> = {
    topic_recall: "话题回温",
    error_memory: "错误记忆",
    decision_consistency: "决策一致性",
    detail_retention: "细节保留",
    cross_association: "跨话题关联",
};

function scoreBar(score: number, width = 20): string {
    const filled = Math.round(score * width);
    const bar = "█".repeat(filled) + "░".repeat(width - filled);
    return bar;
}

function scoreColor(score: number): string {
    if (score >= 0.8) return "\x1b[32m"; // green
    if (score >= 0.5) return "\x1b[33m"; // yellow
    return "\x1b[31m"; // red
}
const RESET = "\x1b[0m";

export function formatTerminalReport(report: BenchmarkReport): string {
    const lines: string[] = [];

    lines.push("");
    lines.push("╔══════════════════════════════════════════════════════════════╗");
    lines.push("║           Agent 上下文记忆能力基准测试报告                  ║");
    lines.push("╚══════════════════════════════════════════════════════════════╝");
    lines.push("");
    lines.push(`  驱动器: ${report.driverName}`);
    lines.push(`  时间:   ${report.timestamp}`);
    lines.push(`  场景数: ${report.scenarios.length}`);
    lines.push("");

    // 总览
    const oc = scoreColor(report.overallScore);
    lines.push(`  总分: ${oc}${(report.overallScore * 100).toFixed(1)}%${RESET}  ${scoreBar(report.overallScore)}`);
    lines.push("");

    // 分类汇总
    lines.push("  ┌──────────────┬───────┬────────────────────────┐");
    lines.push("  │ 记忆能力      │ 得分  │ 分布                    │");
    lines.push("  ├──────────────┼───────┼────────────────────────┤");

    const categories: MemoryCategory[] = [
        "topic_recall", "error_memory", "decision_consistency",
        "detail_retention", "cross_association",
    ];

    for (const cat of categories) {
        const { avg, count } = report.categoryScores[cat];
        const label = CATEGORY_LABELS[cat].padEnd(10);
        const sc = scoreColor(avg);
        const pct = (avg * 100).toFixed(0).padStart(4);
        lines.push(`  │ ${label}  │${sc}${pct}%${RESET} │ ${scoreBar(avg)} │`);
    }

    lines.push("  └──────────────┴───────┴────────────────────────┘");
    lines.push("");

    // 详细结果
    lines.push("  ── 场景详情 ──────────────────────────────────────");
    lines.push("");

    for (const scenario of report.scenarios) {
        const sc = scoreColor(scenario.totalScore);
        lines.push(`  ${sc}●${RESET} ${scenario.scenarioId} — ${scenario.description}`);
        lines.push(`    得分: ${sc}${(scenario.totalScore * 100).toFixed(1)}%${RESET}  耗时: ${scenario.durationMs}ms`);

        for (const cp of scenario.checkpoints) {
            lines.push(`    探测: "${cp.probe.slice(0, 60)}${cp.probe.length > 60 ? "..." : ""}"`);
            lines.push(`    响应: "${cp.response.slice(0, 80)}${cp.response.length > 80 ? "..." : ""}"`);

            for (const cs of cp.criteriaScores) {
                lines.push(`      ${cs.detail}`);
            }
        }
        lines.push("");
    }

    return lines.join("\n");
}

// ── Markdown 报告 ───────────────────────────────────────────────

export function formatMarkdownReport(report: BenchmarkReport): string {
    const lines: string[] = [];

    lines.push("# Agent 上下文记忆能力基准测试报告");
    lines.push("");
    lines.push(`| 属性 | 值 |`);
    lines.push(`|------|-----|`);
    lines.push(`| 驱动器 | ${report.driverName} |`);
    lines.push(`| 时间 | ${report.timestamp} |`);
    lines.push(`| 场景数 | ${report.scenarios.length} |`);
    lines.push(`| **总分** | **${(report.overallScore * 100).toFixed(1)}%** |`);
    lines.push("");

    // 分类汇总
    lines.push("## 分类得分");
    lines.push("");
    lines.push("| 记忆能力 | 得分 | 场景数 | 评级 |");
    lines.push("|---------|------|--------|------|");

    for (const cat of categories) {
        const { avg, count } = report.categoryScores[cat];
        const label = CATEGORY_LABELS[cat];
        const grade = avg >= 0.8 ? "🟢 优秀" : avg >= 0.5 ? "🟡 良好" : "🔴 需改进";
        lines.push(`| ${label} | ${(avg * 100).toFixed(1)}% | ${count} | ${grade} |`);
    }

    lines.push("");

    // 详细结果
    lines.push("## 场景详情");
    lines.push("");

    for (const scenario of report.scenarios) {
        const grade = scenario.totalScore >= 0.8 ? "✅" : scenario.totalScore >= 0.5 ? "⚠️" : "❌";
        lines.push(`### ${grade} ${scenario.scenarioId}`);
        lines.push("");
        lines.push(`- **描述**: ${scenario.description}`);
        lines.push(`- **得分**: ${(scenario.totalScore * 100).toFixed(1)}%`);
        lines.push(`- **耗时**: ${scenario.durationMs}ms`);
        lines.push("");

        for (const cp of scenario.checkpoints) {
            lines.push(`**探测**: ${cp.probe}`);
            lines.push("");
            lines.push(`**响应**: ${cp.response}`);
            lines.push("");
            lines.push("| 标准 | 结果 |");
            lines.push("|------|------|");
            for (const cs of cp.criteriaScores) {
                lines.push(`| ${cs.criterion.type}: "${cs.criterion.value}" | ${cs.detail} |`);
            }
            lines.push("");
        }
    }

    return lines.join("\n");
}

// ── JSON 报告（机器可读）────────────────────────────────────────

export function formatJsonReport(report: BenchmarkReport): string {
    return JSON.stringify(report, null, 2);
}

// ── 多驱动器对比表 ──────────────────────────────────────────────

export function formatComparisonTable(reports: BenchmarkReport[]): string {
    if (reports.length === 0) return "(无数据)";

    const lines: string[] = [];

    lines.push("# Agent CLI 上下文记忆能力横向对比");
    lines.push("");

    // 表头
    const driverNames = reports.map(r => r.driverName);
    lines.push(`| 指标 | ${driverNames.join(" | ")} |`);
    lines.push(`|------|${driverNames.map(() => "------").join("|")}|`);

    // 总分
    lines.push(`| **总分** | ${reports.map(r => `**${(r.overallScore * 100).toFixed(1)}%**`).join(" | ")} |`);

    // 分类得分
    for (const cat of categories) {
        const label = CATEGORY_LABELS[cat];
        const scores = reports.map(r => {
            const cs = r.categoryScores[cat];
            return `${(cs.avg * 100).toFixed(1)}%`;
        });
        lines.push(`| ${label} | ${scores.join(" | ")} |`);
    }

    lines.push("");

    // 雷达图数据（供外部可视化工具使用）
    lines.push("## 雷达图数据（JSON）");
    lines.push("");
    lines.push("```json");
    const radarData = reports.map(r => ({
        name: r.driverName,
        axes: categories.map(cat => ({
            axis: CATEGORY_LABELS[cat],
            value: r.categoryScores[cat].avg,
        })),
    }));
    lines.push(JSON.stringify(radarData, null, 2));
    lines.push("```");

    return lines.join("\n");
}

const categories: MemoryCategory[] = [
    "topic_recall", "error_memory", "decision_consistency",
    "detail_retention", "cross_association",
];
