// ── Benchmark 框架自检 ──────────────────────────────────────────
// 用 Mock 驱动验证评测框架本身的正确性

import { describe, it, expect } from "vitest";
import { MockDriver } from "./drivers.js";
import { runBenchmark, runScenario } from "./evaluator.js";
import { ALL_SCENARIOS } from "./scenarios.js";
import { formatTerminalReport, formatMarkdownReport, formatComparisonTable } from "./reporter.js";
import type { BenchmarkReport } from "./protocol.js";

// ── Mock 驱动器验证 ─────────────────────────────────────────────

describe("MockDriver 行为验证", () => {
    it("perfect 模式应对所有探测返回正确关键词", async () => {
        const driver = new MockDriver("perfect");
        await driver.start();

        // 先植入上下文，再探测
        await driver.send("maxTurns = 50 在 config.toml 中");
        const response = await driver.send("我之前提到的配置文件里 maxTurns 设置的是多少？");
        expect(response.toLowerCase()).toContain("50");
        expect(response.toLowerCase()).toContain("config");

        await driver.close();
    });

    it("amnesia 模式在 filler 后应返回不记得", async () => {
        const driver = new MockDriver("amnesia");
        await driver.start();

        await driver.send("记住这个：密码是 42");
        await driver.sendFiller("无关话题", 10);
        const response = await driver.send("我们之前说的密码是什么？");
        expect(response).toContain("不记得");

        await driver.close();
    });

    it("partial 模式应保留部分信息", async () => {
        const driver = new MockDriver("partial");
        await driver.start();

        const response = await driver.send("之前那个 TypeError 错误发生在哪个文件？");
        expect(response.toLowerCase()).toContain("agent.ts");
        expect(response.toLowerCase()).toContain("contextmanager");

        await driver.close();
    });
});

// ── 评估器验证 ──────────────────────────────────────────────────

describe("评估器正确性", () => {
    it("perfect 驱动器应获得高分（≥80%）", async () => {
        const driver = new MockDriver("perfect");
        const report = await runBenchmark(driver, ALL_SCENARIOS);

        expect(report.overallScore).toBeGreaterThanOrEqual(0.8);
        expect(report.scenarios.length).toBe(ALL_SCENARIOS.length);
    });

    it("amnesia 驱动器应获得低分（≤30%）", async () => {
        const driver = new MockDriver("amnesia");
        const report = await runBenchmark(driver, ALL_SCENARIOS);

        expect(report.overallScore).toBeLessThanOrEqual(0.3);
    });

    it("partial 驱动器得分应在 perfect 和 amnesia 之间", async () => {
        const perfect = await runBenchmark(new MockDriver("perfect"), ALL_SCENARIOS);
        const partial = await runBenchmark(new MockDriver("partial"), ALL_SCENARIOS);
        const amnesia = await runBenchmark(new MockDriver("amnesia"), ALL_SCENARIOS);

        expect(partial.overallScore).toBeLessThan(perfect.overallScore);
        expect(partial.overallScore).toBeGreaterThan(amnesia.overallScore);
    });

    it("每个场景的分数应在 0-1 之间", async () => {
        const driver = new MockDriver("perfect");
        const report = await runBenchmark(driver, ALL_SCENARIOS);

        for (const scenario of report.scenarios) {
            expect(scenario.totalScore).toBeGreaterThanOrEqual(0);
            expect(scenario.totalScore).toBeLessThanOrEqual(1);
        }
    });

    it("分类汇总应覆盖所有 5 个类别", async () => {
        const driver = new MockDriver("perfect");
        const report = await runBenchmark(driver, ALL_SCENARIOS);

        const cats = Object.keys(report.categoryScores);
        expect(cats).toContain("topic_recall");
        expect(cats).toContain("error_memory");
        expect(cats).toContain("decision_consistency");
        expect(cats).toContain("detail_retention");
        expect(cats).toContain("cross_association");
    });
});

// ── 报告器验证 ──────────────────────────────────────────────────

describe("报告格式化", () => {
    let report: BenchmarkReport;

    it("生成报告数据", async () => {
        const driver = new MockDriver("perfect");
        report = await runBenchmark(driver, ALL_SCENARIOS);
    });

    it("终端报告应包含关键信息", () => {
        const text = formatTerminalReport(report);
        expect(text).toContain("基准测试报告");
        expect(text).toContain("mock-perfect");
        expect(text).toContain("话题回温");
        expect(text).toContain("错误记忆");
    });

    it("Markdown 报告应是合法格式", () => {
        const md = formatMarkdownReport(report);
        expect(md).toContain("# Agent");
        expect(md).toContain("| 记忆能力");
        expect(md).toContain("###");
    });

    it("对比表应包含所有驱动器", async () => {
        const reports = await Promise.all([
            runBenchmark(new MockDriver("perfect"), ALL_SCENARIOS),
            runBenchmark(new MockDriver("amnesia"), ALL_SCENARIOS),
        ]);

        const table = formatComparisonTable(reports);
        expect(table).toContain("mock-perfect");
        expect(table).toContain("mock-amnesia");
        expect(table).toContain("横向对比");
    });
});

// ── 场景有效性验证 ──────────────────────────────────────────────

describe("场景定义完整性", () => {
    for (const scenario of ALL_SCENARIOS) {
        it(`${scenario.id} 应有至少 1 个 checkpoint`, () => {
            const checkpoints = scenario.steps.filter(s => s.type === "checkpoint");
            expect(checkpoints.length).toBeGreaterThanOrEqual(1);
        });

        it(`${scenario.id} 的 checkpoint 应有 criteria`, () => {
            for (const step of scenario.steps) {
                if (step.type === "checkpoint") {
                    expect(step.criteria.length).toBeGreaterThan(0);
                    const totalWeight = step.criteria.reduce((s, c) => s + c.weight, 0);
                    expect(totalWeight).toBeCloseTo(1, 1); // 权重之和约等于 1
                }
            }
        });
    }
});
