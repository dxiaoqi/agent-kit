// ── Docker 容器沙箱策略 ──────────────────────────────────────────
// 作为 native 策略的备选方案，适用于：
//   - Windows（无原生沙箱工具）
//   - 需要更强隔离的场景
//   - native 策略不可用时的回退
//
// 隔离维度对齐 Claude Code 模型：
//   文件系统 — cwd 挂载为 /workspace（读写），allowWrite 额外挂载，denyRead 不挂载
//   网络     — --network=none 或使用默认 bridge
//   进程     — 容器 PID namespace 天然隔离
//   资源     — --memory, --cpus, --pids-limit
//   安全     — --cap-drop=ALL + 最小 cap 恢复，--security-opt=no-new-privileges

import { spawn, execSync } from "node:child_process";
import type { SandboxConfig, SandboxResult, SandboxStrategy } from "./types.js";
import { resolveSandboxPath } from "./types.js";

export class DockerStrategy implements SandboxStrategy {
    readonly type = "docker" as const;
    private _available: boolean | null = null;

    isAvailable(): boolean {
        if (this._available !== null) return this._available;
        try {
            execSync("docker info", { stdio: "ignore", timeout: 5000 });
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
        const args = this.buildArgs(command, cwd, config);

        const proc = spawn("docker", args, {
            stdio: ["ignore", "pipe", "pipe"],
            timeout: config.timeout,
        });

        return this.collectOutput(proc, signal, startTime, config.maxOutput);
    }

    private buildArgs(command: string, cwd: string, config: SandboxConfig): string[] {
        const docker = config.docker;
        const fs = config.filesystem;
        const args: string[] = ["run", "--rm", "-i"];

        // 网络
        if (config.network.allowedDomains.length === 0) {
            args.push("--network=none");
        }

        // 资源限制
        args.push(`--memory=${docker.memoryLimit}`);
        args.push(`--cpus=${docker.cpuLimit}`);
        args.push("--pids-limit=256");

        // 安全
        args.push("--security-opt=no-new-privileges");
        args.push("--cap-drop=ALL");
        args.push("--cap-add=CHOWN", "--cap-add=DAC_OVERRIDE",
                   "--cap-add=FOWNER", "--cap-add=SETGID", "--cap-add=SETUID");

        args.push("--tmpfs=/tmp:rw,noexec,nosuid,size=64m");

        // UID mapping（Linux/macOS）
        if (process.platform !== "win32") {
            const uid = process.getuid?.();
            const gid = process.getgid?.();
            if (uid !== undefined && gid !== undefined) {
                args.push(`--user=${uid}:${gid}`);
            }
        }

        // CWD 挂载（读写）
        args.push("-v", `${cwd}:/workspace`);
        args.push("-w", "/workspace");

        // allowWrite 挂载
        for (const p of fs.allowWrite) {
            const abs = resolveSandboxPath(p, cwd);
            const isDenied = fs.denyRead.some(d =>
                abs.startsWith(resolveSandboxPath(d, cwd)));
            if (!isDenied) {
                args.push("-v", `${abs}:${abs}`);
            }
        }

        args.push("-e", "TERM=dumb");
        args.push("-e", "HOME=/tmp/home");

        args.push(...docker.extraArgs);
        args.push(docker.image);
        args.push("bash", "-c", command);

        return args;
    }

    private collectOutput(
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
                    strategy: "docker",
                    killed,
                    durationMs: Date.now() - startTime,
                });
            });

            proc.on("error", (err) => {
                resolve({
                    stdout: "",
                    stderr: `Docker error: ${err.message}`,
                    exitCode: null,
                    strategy: "docker",
                    killed: false,
                    durationMs: Date.now() - startTime,
                });
            });
        });
    }

    async ensureImage(image: string): Promise<boolean> {
        return new Promise((resolve) => {
            const proc = spawn("docker", ["image", "inspect", image], { stdio: "ignore" });
            proc.on("close", (code) => {
                if (code === 0) { resolve(true); return; }
                const pull = spawn("docker", ["pull", image], {
                    stdio: "ignore", timeout: 120_000,
                });
                pull.on("close", (c) => resolve(c === 0));
                pull.on("error", () => resolve(false));
            });
            proc.on("error", () => resolve(false));
        });
    }
}
