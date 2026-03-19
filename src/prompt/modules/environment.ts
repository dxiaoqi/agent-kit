// ── Environment 模块 ─────────────────────────────────────────────
// 动态注入运行环境信息：OS、Shell、日期、CWD、可用工具、沙箱状态。

import type { PromptModule, PromptContext } from "../types.js";

export const environmentModule: PromptModule = {
    id: "environment",
    priority: 10,
    render(ctx: PromptContext): string {
        const lines = [
            "## Environment",
            "",
            `- OS: ${ctx.os}`,
            `- Shell: ${ctx.shell}`,
            `- Working directory: ${ctx.cwd}`,
            `- Date: ${ctx.date}`,
        ];

        if (ctx.toolNames.length > 0) {
            lines.push(`- Available tools: ${ctx.toolNames.join(", ")}`);
        }

        if (ctx.sandboxInfo) {
            const sb = ctx.sandboxInfo;
            lines.push("");
            lines.push("## Sandbox");
            if (sb.available && sb.mode !== "off") {
                lines.push(`- Sandbox: **active** (${sb.platform}, mode: ${sb.mode})`);
                lines.push("- Shell commands run in a restricted sandbox with limited filesystem and network access");
                if (sb.mode === "auto-allow") {
                    lines.push("- Sandboxed commands are auto-approved without user confirmation");
                    lines.push("- Commands that cannot be sandboxed (excluded commands, incompatible tools) fall back to standard permission flow");
                } else {
                    lines.push("- All commands go through standard permission flow, even sandboxed ones");
                }
                lines.push("- **Sandbox failure escalation**: if a command fails with `[exit code: signal]` or sandbox error, immediately retry with `dangerouslyDisableSandbox: true` — do NOT retry the same sandboxed command");
            } else if (sb.mode === "off") {
                lines.push("- Sandbox: disabled");
            } else {
                lines.push(`- Sandbox: not available on this platform (${sb.platform})`);
            }
        }

        return lines.join("\n");
    },
};
