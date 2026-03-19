// ── SandboxExecutor ──────────────────────────────────────────────
// 对齐 Claude Code 沙箱执行模型：
//
// 决策流程（execute 时）：
//   1. sandbox.enabled = false → 直接执行
//   2. excludedCommands 匹配 → 直接执行（跳过沙箱）
//   3. dangerouslyDisableSandbox = true → 直接执行（需权限系统审批）
//   4. 选择策略（preferStrategy > 回退）→ 沙箱执行
//   5. 无可用策略 → 直接执行（带警告）
//
// 权限分流（由 BashTool / PermissionEngine 处理）：
//   permissions = "auto-allow" → 沙箱内的命令免审批
//   permissions = "default"    → 所有命令走标准审批

import { spawn } from "node:child_process";
import type {
    SandboxConfig,
    SandboxResult,
    SandboxStrategy,
    SandboxStrategyType,
    SandboxPlatform,
} from "./types.js";
import { detectPlatform } from "./types.js";
import { DockerStrategy } from "./docker.js";
import { createNativeStrategy } from "./native.js";

export interface ExecuteOptions {
    /** 逃生舱：强制跳过沙箱（仍需权限审批） */
    dangerouslyDisableSandbox?: boolean;
}

export class SandboxExecutor {
    private readonly platform: SandboxPlatform;
    private readonly strategies: Map<SandboxStrategyType, SandboxStrategy>;
    private _resolvedStrategy: SandboxStrategy | null | undefined = undefined;

    constructor(private readonly config: SandboxConfig) {
        this.platform = detectPlatform();
        this.strategies = new Map();
        this.strategies.set("docker", new DockerStrategy());
        this.strategies.set("native", createNativeStrategy());
    }

    // ── 策略解析 ────────────────────────────────────────────────

    resolveStrategy(): SandboxStrategy | null {
        if (this._resolvedStrategy !== undefined) return this._resolvedStrategy;
        if (!this.config.enabled) { this._resolvedStrategy = null; return null; }

        const order = this.getStrategyOrder();
        for (const type of order) {
            const strategy = this.strategies.get(type);
            if (strategy?.isAvailable()) {
                this._resolvedStrategy = strategy;
                return strategy;
            }
        }

        this._resolvedStrategy = null;
        return null;
    }

    private getStrategyOrder(): SandboxStrategyType[] {
        const preferred = this.config.preferStrategy;
        const all: SandboxStrategyType[] = ["native", "docker"];
        return [preferred, ...all.filter(s => s !== preferred)];
    }

    isSandboxAvailable(): boolean {
        return this.resolveStrategy() !== null;
    }

    // ── 命令排除检查 ────────────────────────────────────────────

    isCommandExcluded(command: string): boolean {
        const trimmed = command.trim();
        return this.config.excludedCommands.some(prefix => {
            if (trimmed === prefix) return true;
            if (trimmed.startsWith(prefix + " ")) return true;
            // 处理管道和链式命令中的第一个命令
            const firstCmd = trimmed.split(/[|;&]/, 1)[0].trim();
            return firstCmd === prefix || firstCmd.startsWith(prefix + " ");
        });
    }

    // ── 主执行入口 ──────────────────────────────────────────────

    async execute(
        command: string,
        cwd: string,
        signal?: AbortSignal,
        opts?: ExecuteOptions,
    ): Promise<SandboxResult> {
        // 1. 沙箱未启用
        if (!this.config.enabled) {
            return this.executeDirect(command, cwd, signal);
        }

        // 2. 命令在排除列表中
        if (this.isCommandExcluded(command)) {
            return this.executeDirect(command, cwd, signal);
        }

        // 3. 逃生舱
        if (opts?.dangerouslyDisableSandbox) {
            if (!this.config.allowUnsandboxedCommands) {
                return {
                    stdout: "",
                    stderr: "dangerouslyDisableSandbox is disabled by configuration (allowUnsandboxedCommands=false)",
                    exitCode: 1,
                    strategy: "none",
                    killed: false,
                    durationMs: 0,
                };
            }
            return this.executeDirect(command, cwd, signal);
        }

        // 4. 尝试沙箱策略
        const strategy = this.resolveStrategy();
        if (strategy) {
            return strategy.execute(command, cwd, this.config, signal);
        }

        // 5. 无可用策略 → 回退
        return this.executeDirect(command, cwd, signal);
    }

    // ── 判断某次执行是否会走沙箱 ────────────────────────────────
    // 供权限引擎使用：判断该命令是否会被沙箱化

    willSandbox(command: string, opts?: ExecuteOptions): boolean {
        if (!this.config.enabled) return false;
        if (this.isCommandExcluded(command)) return false;
        if (opts?.dangerouslyDisableSandbox && this.config.allowUnsandboxedCommands) return false;
        return this.isSandboxAvailable();
    }

    // ── Direct 执行（无沙箱） ────────────────────────────────────

    private executeDirect(
        command: string,
        cwd: string,
        signal?: AbortSignal,
    ): Promise<SandboxResult> {
        const startTime = Date.now();

        const shell = this.platform === "windows"
            ? { cmd: "cmd.exe", args: ["/c", command] }
            : { cmd: "bash",   args: ["-c", command] };

        const proc = spawn(shell.cmd, shell.args, {
            cwd,
            env: { ...process.env, TERM: "dumb" },
            stdio: ["ignore", "pipe", "pipe"],
            timeout: this.config.timeout,
        });

        return new Promise((resolve) => {
            let stdout = "";
            let stderr = "";
            let killed = false;

            proc.stdout?.on("data", (chunk: Buffer) => {
                stdout += chunk.toString();
                if (stdout.length > this.config.maxOutput) {
                    proc.kill("SIGKILL");
                    killed = true;
                }
            });

            proc.stderr?.on("data", (chunk: Buffer) => {
                stderr += chunk.toString();
                if (stderr.length > this.config.maxOutput) {
                    proc.kill("SIGKILL");
                    killed = true;
                }
            });

            if (signal) {
                signal.addEventListener("abort", () => {
                    proc.kill("SIGTERM");
                    killed = true;
                }, { once: true });
            }

            proc.on("close", (code) => {
                resolve({
                    stdout: stdout.trimEnd(),
                    stderr: stderr.trimEnd(),
                    exitCode: code,
                    strategy: "none",
                    killed,
                    durationMs: Date.now() - startTime,
                });
            });

            proc.on("error", (err) => {
                resolve({
                    stdout: "",
                    stderr: `Failed to spawn: ${err.message}`,
                    exitCode: null,
                    strategy: "none",
                    killed: false,
                    durationMs: Date.now() - startTime,
                });
            });
        });
    }

    // ── 信息查询 ────────────────────────────────────────────────

    get enabled(): boolean { return this.config.enabled; }
    get permissions(): string { return this.config.permissions; }

    getInfo(): {
        platform: SandboxPlatform;
        enabled: boolean;
        permissions: string;
        preferStrategy: SandboxStrategyType;
        available: Record<SandboxStrategyType, boolean>;
        activeStrategy: SandboxStrategyType | "none";
        excludedCommands: string[];
    } {
        const available: Record<string, boolean> = {};
        for (const [type, strategy] of this.strategies) {
            available[type] = strategy.isAvailable();
        }

        return {
            platform: this.platform,
            enabled: this.config.enabled,
            permissions: this.config.permissions,
            preferStrategy: this.config.preferStrategy,
            available: available as Record<SandboxStrategyType, boolean>,
            activeStrategy: this.resolveStrategy()?.type ?? "none",
            excludedCommands: this.config.excludedCommands,
        };
    }

    getDockerStrategy(): DockerStrategy | null {
        const s = this.strategies.get("docker");
        return s instanceof DockerStrategy ? s : null;
    }

    getInstallHint(): string {
        const hints: string[] = [];
        switch (this.platform) {
            case "macos":
                hints.push("macOS sandbox-exec (Seatbelt) is built-in.");
                hints.push("Or install Docker Desktop: https://docs.docker.com/desktop/mac/install/");
                break;
            case "linux":
                hints.push("Install bubblewrap: sudo apt install bubblewrap socat");
                hints.push("Or install Docker: curl -fsSL https://get.docker.com | sh");
                break;
            case "windows":
                hints.push("Install Docker Desktop (WSL2 backend): https://docs.docker.com/desktop/windows/install/");
                break;
            default:
                hints.push("Install Docker: https://docs.docker.com/get-docker/");
        }
        return hints.join(" ");
    }
}
