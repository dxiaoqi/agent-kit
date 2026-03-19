#!/usr/bin/env npx tsx
// ── 基准测试 CLI 入口 ───────────────────────────────────────────
//
// 用法：
//   npx tsx tests/benchmark/run.ts                      # 使用 mock 驱动
//   npx tsx tests/benchmark/run.ts --driver stdio \
//       --command "npx tsx src/main.ts" --name agent-kit  # 使用 stdio 驱动
//   npx tsx tests/benchmark/run.ts --format markdown      # Markdown 输出
//   npx tsx tests/benchmark/run.ts --compare              # 三种 mock 对比

import { ALL_SCENARIOS } from "./scenarios.js";
import { MockDriver, StdioDriver } from "./drivers.js";
import { runBenchmark } from "./evaluator.js";
import {
    formatTerminalReport,
    formatMarkdownReport,
    formatJsonReport,
    formatComparisonTable,
} from "./reporter.js";
import type { AgentDriver, BenchmarkReport } from "./protocol.js";

async function main() {
    const args = process.argv.slice(2);
    const flags = parseFlags(args);

    if (flags.compare) {
        await runComparison(flags.format);
        return;
    }

    const driver = createDriver(flags);

    console.log(`\n  ▶ 运行基准测试 [${driver.name}] — ${ALL_SCENARIOS.length} 个场景\n`);

    const report = await runBenchmark(driver, ALL_SCENARIOS, {
        onProgress(done, total) {
            process.stdout.write(`\r  进度: ${done + 1}/${total}`);
        },
    });

    process.stdout.write("\r" + " ".repeat(30) + "\r");
    printReport(report, flags.format);

    if (flags.output) {
        const fs = await import("node:fs");
        const content = flags.format === "json"
            ? formatJsonReport(report)
            : formatMarkdownReport(report);
        fs.writeFileSync(flags.output, content, "utf-8");
        console.log(`\n  📄 报告已保存到 ${flags.output}`);
    }
}

async function runComparison(format: string) {
    const modes = ["perfect", "partial", "amnesia"] as const;
    const reports: BenchmarkReport[] = [];

    for (const mode of modes) {
        const driver = new MockDriver(mode);
        console.log(`  ▶ 运行 mock-${mode}...`);
        const report = await runBenchmark(driver, ALL_SCENARIOS);
        reports.push(report);
    }

    console.log(formatComparisonTable(reports));

    for (const report of reports) {
        console.log(`\n${"─".repeat(60)}`);
        printReport(report, format);
    }
}

function createDriver(flags: Flags): AgentDriver {
    if (flags.driver === "stdio") {
        if (!flags.command) {
            console.error("  ✗ --driver stdio 需要 --command 参数");
            process.exit(1);
        }
        const parts = flags.command.split(" ");
        return new StdioDriver({
            name: flags.name ?? "unknown-agent",
            command: parts[0],
            args: parts.slice(1),
            cwd: flags.cwd,
            timeout: flags.timeout,
        });
    }

    // 默认：mock 驱动
    return new MockDriver(flags.mock ?? "perfect");
}

function printReport(report: BenchmarkReport, format: string) {
    switch (format) {
        case "json":
            console.log(formatJsonReport(report));
            break;
        case "markdown":
            console.log(formatMarkdownReport(report));
            break;
        default:
            console.log(formatTerminalReport(report));
            break;
    }
}

// ── Flag 解析 ────────────────────────────────────────────────────

interface Flags {
    driver: "mock" | "stdio";
    mock?: "perfect" | "partial" | "amnesia";
    command?: string;
    name?: string;
    cwd?: string;
    timeout?: number;
    format: string;
    output?: string;
    compare: boolean;
}

function parseFlags(args: string[]): Flags {
    const flags: Flags = { driver: "mock", format: "terminal", compare: false };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case "--driver":    flags.driver = args[++i] as any; break;
            case "--mock":      flags.mock = args[++i] as any; break;
            case "--command":   flags.command = args[++i]; break;
            case "--name":      flags.name = args[++i]; break;
            case "--cwd":       flags.cwd = args[++i]; break;
            case "--timeout":   flags.timeout = Number(args[++i]); break;
            case "--format":    flags.format = args[++i]; break;
            case "--output":    flags.output = args[++i]; break;
            case "--compare":   flags.compare = true; break;
        }
    }

    return flags;
}

main().catch(err => {
    console.error("Benchmark failed:", err);
    process.exit(1);
});
