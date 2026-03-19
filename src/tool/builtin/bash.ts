// ── Bash 工具 ────────────────────────────────────────────────────
// 对齐 Claude Code BashTool 沙箱模型：
//
// 执行流程：
//   1. sandbox 注入且 enabled → executor.execute() 决定沙箱/直接
//   2. dangerouslyDisableSandbox = true → 跳过沙箱，走权限审批
//   3. 无 sandbox → 直接执行（原始行为）
//
// 权限分流（由 PermissionEngine 实现）：
//   sandbox.permissions = "auto-allow" + willSandbox(cmd) → 免审批
//   sandbox.permissions = "default" 或未沙箱化 → 走标准审批

import { z } from "zod";
import { spawn } from "child_process";
import type { ToolDef, ToolResult, ToolContext } from "../types.js";
import { SandboxExecutor } from "../../sandbox/executor.js";

const inputSchema = z.object({
    command: z.string().describe("The shell command to execute"),
    timeout: z.number().optional().describe("Timeout in milliseconds (default: 30000)"),
    dangerouslyDisableSandbox: z.boolean().optional().describe(
        "Escape hatch: run command outside sandbox. Requires user permission approval. " +
        "Only use when the command fails due to sandbox restrictions (e.g., network issues, incompatible tools).",
    ),
});

type BashInput = z.infer<typeof inputSchema>;

const MAX_BUFFER = 1024 * 1024;
const DEFAULT_TIMEOUT = 30_000;

let _sandboxExecutor: SandboxExecutor | null = null;

export function injectSandboxExecutor(executor: SandboxExecutor): void {
    _sandboxExecutor = executor;
}

export function getSandboxExecutor(): SandboxExecutor | null {
    return _sandboxExecutor;
}

export const bashTool: ToolDef<BashInput> = {
    name: "bash",
    description: `Execute a shell command in the user's environment.

Use this tool to:
- Run build commands (npm, cargo, make, etc.)
- Check file existence and directory structure (ls, find)
- Run tests and scripts
- Git operations
- Install packages

Rules:
- Always prefer non-interactive commands
- For long-running processes, add appropriate timeouts
- Never run destructive commands (rm -rf /) without user confirmation
- Combine related commands with && for efficiency
- Commands may run in a sandbox with restricted filesystem and network access
- If a command fails due to sandbox restrictions, you may retry with dangerouslyDisableSandbox: true (requires user approval)`,

    inputSchema,
    isReadOnly: false,

    async execute(input: BashInput, ctx: ToolContext): Promise<ToolResult> {
        const timeout = input.timeout ?? DEFAULT_TIMEOUT;

        if (_sandboxExecutor && _sandboxExecutor.enabled) {
            return executeSandboxed(input.command, ctx, timeout, input.dangerouslyDisableSandbox);
        }

        return executeDirect(input.command, ctx, timeout);
    },
};

async function executeSandboxed(
    command: string,
    ctx: ToolContext,
    _timeout: number,
    dangerouslyDisableSandbox?: boolean,
): Promise<ToolResult> {
    const executor = _sandboxExecutor!;

    const result = await executor.execute(command, ctx.cwd, ctx.abortSignal, {
        dangerouslyDisableSandbox,
    });

    const strategyTag = result.strategy !== "none" ? ` [${result.strategy}]` : "";

    if (result.killed) {
        return {
            success: false,
            error: `Output exceeded limit or was aborted${strategyTag}`,
        };
    }

    const output = [
        result.stdout || "",
        result.stderr ? `\n[stderr]\n${result.stderr}` : "",
        `\n[exit code: ${result.exitCode ?? "signal"}]${strategyTag}`,
    ].join("");

    if (result.exitCode === 0) {
        return { success: true, output };
    }
    return { success: false, error: output };
}

async function executeDirect(
    command: string,
    ctx: ToolContext,
    timeout: number,
): Promise<ToolResult> {
    return new Promise((resolve) => {
        const proc = spawn("bash", ["-c", command], {
            cwd: ctx.cwd,
            env: { ...process.env, TERM: "dumb" },
            stdio: ["ignore", "pipe", "pipe"],
            timeout,
        });

        let stdout = "";
        let stderr = "";
        let killed = false;

        proc.stdout.on("data", (chunk: Buffer) => {
            stdout += chunk.toString();
            if (stdout.length > MAX_BUFFER) {
                proc.kill("SIGKILL");
                killed = true;
            }
        });

        proc.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
            if (stderr.length > MAX_BUFFER) {
                proc.kill("SIGKILL");
                killed = true;
            }
        });

        if (ctx.abortSignal) {
            ctx.abortSignal.addEventListener("abort", () => {
                proc.kill("SIGTERM");
            }, { once: true });
        }

        proc.on("close", (code) => {
            if (killed) {
                resolve({
                    success: false,
                    error: `Output exceeded ${MAX_BUFFER} bytes and was killed`,
                });
                return;
            }

            const output = [
                stdout ? stdout.trimEnd() : "",
                stderr ? `\n[stderr]\n${stderr.trimEnd()}` : "",
                `\n[exit code: ${code ?? "signal"}]`,
            ].join("");

            if (code === 0) {
                resolve({ success: true, output });
            } else {
                resolve({ success: false, error: output });
            }
        });

        proc.on("error", (err) => {
            resolve({ success: false, error: `Failed to spawn process: ${err.message}` });
        });
    });
}
