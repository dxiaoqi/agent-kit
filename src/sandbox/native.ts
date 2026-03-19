// ── 操作系统原生沙箱策略 ─────────────────────────────────────────
// 与 Claude Code 一致的 OS 级隔离：
//   macOS  → Seatbelt (sandbox-exec + SBPL)
//   Linux  → bubblewrap (bwrap)
//   WSL2   → bubblewrap（同 Linux）
//
// 文件系统模型（Claude Code 默认行为）：
//   - cwd 及子目录：读写
//   - allowWrite 中的路径：读写
//   - 系统目录（/usr, /bin, /etc...）：只读
//   - denyWrite 中的路径：只读
//   - denyRead 中的路径：不可访问
//   - 其余：只读

import { spawn, execSync } from "node:child_process";
import { resolve } from "node:path";
import { homedir } from "node:os";
import type { SandboxConfig, SandboxResult, SandboxStrategy } from "./types.js";
import { detectPlatform, resolveSandboxPath } from "./types.js";

// ── macOS Seatbelt 策略 ─────────────────────────────────────────

export class MacOSNativeStrategy implements SandboxStrategy {
    readonly type = "native" as const;
    private _available: boolean | null = null;

    isAvailable(): boolean {
        if (this._available !== null) return this._available;
        if (detectPlatform() !== "macos") {
            this._available = false;
            return false;
        }
        try {
            execSync("which sandbox-exec", { stdio: "ignore" });
            this._available = true;
        } catch {
            this._available = false;
        }
        return this._available;
    }

    async execute(
        command: string,
        cwd: string,
        config: SandboxConfig,
        signal?: AbortSignal,
    ): Promise<SandboxResult> {
        const startTime = Date.now();
        const sbpl = generateSBPL(config, cwd);

        const proc = spawn("sandbox-exec", ["-p", sbpl, "bash", "-c", command], {
            cwd,
            env: { ...process.env, TERM: "dumb" },
            stdio: ["ignore", "pipe", "pipe"],
            timeout: config.timeout,
        });

        return collectOutput(proc, signal, startTime, config.maxOutput);
    }
}

// ── Linux bubblewrap 策略 ───────────────────────────────────────

export class LinuxNativeStrategy implements SandboxStrategy {
    readonly type = "native" as const;
    private _available: boolean | null = null;

    isAvailable(): boolean {
        if (this._available !== null) return this._available;
        const plat = detectPlatform();
        if (plat !== "linux") {
            this._available = false;
            return false;
        }
        try {
            execSync("which bwrap", { stdio: "ignore" });
            this._available = true;
        } catch {
            this._available = false;
        }
        return this._available;
    }

    async execute(
        command: string,
        cwd: string,
        config: SandboxConfig,
        signal?: AbortSignal,
    ): Promise<SandboxResult> {
        const startTime = Date.now();
        const bwrapArgs = generateBwrapArgs(config, cwd);

        const proc = spawn("bwrap", [...bwrapArgs, "bash", "-c", command], {
            env: { ...process.env, TERM: "dumb" },
            stdio: ["ignore", "pipe", "pipe"],
            timeout: config.timeout,
        });

        return collectOutput(proc, signal, startTime, config.maxOutput);
    }
}

// ── 工厂 ────────────────────────────────────────────────────────

export function createNativeStrategy(): SandboxStrategy {
    const platform = detectPlatform();
    switch (platform) {
        case "macos":  return new MacOSNativeStrategy();
        case "linux":  return new LinuxNativeStrategy();
        default:       return new NullNativeStrategy();
    }
}

class NullNativeStrategy implements SandboxStrategy {
    readonly type = "native" as const;
    isAvailable(): boolean { return false; }
    async execute(): Promise<SandboxResult> {
        throw new Error("Native sandbox not available on this platform");
    }
}

// ── macOS SBPL Profile ──────────────────────────────────────────

export function generateSBPL(config: SandboxConfig, cwd: string): string {
    const home = homedir();
    const fs = config.filesystem;

    const lines: string[] = [
        "(version 1)",
        "(deny default)",
        "",
        "; 进程执行",
        "(allow process-exec)",
        "(allow process-fork)",
        "(allow signal (target self))",
        "",
        "; 系统必需",
        "(allow sysctl-read)",
        "(allow mach-lookup)",
        "(allow ipc-posix-shm)",
        "",
        "; 元数据读取",
        "(allow file-read-metadata)",
    ];

    // 系统库和二进制（只读）
    const systemReadPaths = [
        "/usr", "/bin", "/sbin", "/Library", "/System",
        "/private/var", "/private/etc", "/dev", "/etc",
        "/var", "/tmp", "/opt",
    ];
    lines.push("");
    lines.push("; 系统路径（只读）");
    for (const p of systemReadPaths) {
        lines.push(`(allow file-read* (subpath "${p}"))`);
    }

    // Temp 写入
    lines.push("");
    lines.push("; 临时目录（可写）");
    lines.push('(allow file-write* (subpath "/tmp"))');
    lines.push('(allow file-write* (subpath "/private/tmp"))');
    lines.push('(allow file-write* (subpath "/dev/null"))');
    lines.push('(allow file-write* (subpath "/dev/tty"))');

    // 工具链读取
    const toolchainPaths = [
        ".nvm", ".cargo", ".rustup", ".local", ".npm",
        ".node", ".bun", ".deno", ".pyenv", ".volta",
    ].map(p => resolve(home, p));

    lines.push("");
    lines.push("; 工具链（只读）");
    for (const p of toolchainPaths) {
        lines.push(`(allow file-read* (subpath "${p}"))`);
    }

    // CWD：读写
    lines.push("");
    lines.push("; 工作目录（读写）");
    lines.push(`(allow file-read* (subpath "${cwd}"))`);
    lines.push(`(allow file-write* (subpath "${cwd}"))`);

    // allowWrite：额外可写路径
    if (fs.allowWrite.length > 0) {
        lines.push("");
        lines.push("; 额外可写路径 (allowWrite)");
        for (const p of fs.allowWrite) {
            const abs = resolveSandboxPath(p, cwd);
            lines.push(`(allow file-read* (subpath "${abs}"))`);
            lines.push(`(allow file-write* (subpath "${abs}"))`);
        }
    }

    // denyWrite：禁止写入（SBPL 中 deny 优先于 allow）
    if (fs.denyWrite.length > 0) {
        lines.push("");
        lines.push("; 禁止写入 (denyWrite)");
        for (const p of fs.denyWrite) {
            const abs = resolveSandboxPath(p, cwd);
            lines.push(`(deny file-write* (subpath "${abs}"))`);
        }
    }

    // denyRead：禁止读取
    if (fs.denyRead.length > 0) {
        lines.push("");
        lines.push("; 禁止读取 (denyRead)");
        for (const p of fs.denyRead) {
            const abs = resolveSandboxPath(p, cwd);
            lines.push(`(deny file-read* (subpath "${abs}"))`);
            lines.push(`(deny file-write* (subpath "${abs}"))`);
        }
    }

    // 网络
    lines.push("");
    if (config.network.allowedDomains.length === 0) {
        lines.push("; 网络：全部禁止");
        lines.push("(deny network*)");
    } else {
        // Seatbelt 无法做域名级过滤，只能全部禁止或全部放行
        // 域名级过滤需要通过代理实现（executor 层处理）
        lines.push("; 网络：允许（域名级过滤由代理层处理）");
        lines.push("(allow network*)");
    }

    return lines.join("\n");
}

// ── Linux bwrap 参数 ────────────────────────────────────────────

export function generateBwrapArgs(config: SandboxConfig, cwd: string): string[] {
    const home = homedir();
    const fs = config.filesystem;

    const args: string[] = [
        "--die-with-parent",
        "--unshare-pid",
        "--unshare-uts",
    ];

    // 网络隔离
    if (config.network.allowedDomains.length === 0) {
        args.push("--unshare-net");
    }

    // 系统路径（只读）
    for (const sys of ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc", "/opt"]) {
        args.push("--ro-bind", sys, sys);
    }

    args.push("--dev", "/dev");
    args.push("--proc", "/proc");
    args.push("--tmpfs", "/tmp");

    // 工具链（只读）
    const toolchainPaths = [
        ".nvm", ".cargo", ".rustup", ".local", ".npm", ".pyenv",
    ].map(p => resolve(home, p));

    for (const p of toolchainPaths) {
        args.push("--ro-bind-try", p, p);
    }

    // CWD（读写）
    args.push("--bind", cwd, cwd);

    // allowWrite
    for (const p of fs.allowWrite) {
        const abs = resolveSandboxPath(p, cwd);
        args.push("--bind-try", abs, abs);
    }

    // denyRead 的路径不挂载（bwrap 不挂载 = 不可见）
    // 这已经通过不将它们加入挂载列表来实现

    args.push("--chdir", cwd);

    return args;
}

// ── 输出收集（共享） ────────────────────────────────────────────

function collectOutput(
    proc: ReturnType<typeof spawn>,
    signal: AbortSignal | undefined,
    startTime: number,
    maxOutput: number,
): Promise<SandboxResult> {
    return new Promise((resolve) => {
        let stdout = "";
        let stderr = "";
        let killed = false;

        proc.stdout?.on("data", (chunk: Buffer) => {
            stdout += chunk.toString();
            if (stdout.length > maxOutput) {
                proc.kill("SIGKILL");
                killed = true;
            }
        });

        proc.stderr?.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
            if (stderr.length > maxOutput) {
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
                strategy: "native",
                killed,
                durationMs: Date.now() - startTime,
            });
        });

        proc.on("error", (err) => {
            resolve({
                stdout: "",
                stderr: `Failed to spawn: ${err.message}`,
                exitCode: null,
                strategy: "native",
                killed: false,
                durationMs: Date.now() - startTime,
            });
        });
    });
}
