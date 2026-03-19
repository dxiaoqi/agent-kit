// ── 沙箱类型定义 ─────────────────────────────────────────────────
// 对齐 Claude Code 沙箱设计：
// https://code.claude.com/docs/zh-CN/sandboxing
//
// 核心理念：
//   1. OS 级强制隔离（macOS Seatbelt, Linux bubblewrap, Docker 备选）
//   2. 文件系统：cwd 可写，其余只读，deny 列表不可覆盖
//   3. 网络：域名白名单 + 代理服务器控制
//   4. 权限分流：auto-allow（沙箱内免审批）vs default（全部走审批）
//   5. 逃生舱：dangerouslyDisableSandbox + excludedCommands

// ── 沙箱权限模式 ────────────────────────────────────────────────

export type SandboxPermissions =
    | "auto-allow"  // 沙箱内的命令自动放行，不走权限审批
    | "default";    // 所有命令走标准权限流程（即使在沙箱中也要审批）

// ── 沙箱隔离策略 ────────────────────────────────────────────────

export type SandboxStrategyType = "native" | "docker";

// ── 文件系统隔离配置 ────────────────────────────────────────────
// 路径前缀约定（与 Claude Code 一致）：
//   //   → 绝对路径（从文件系统根）  e.g. //tmp/build → /tmp/build
//   ~/   → 相对于 $HOME             e.g. ~/.kube → $HOME/.kube
//   ./   → 相对于 cwd（默认）        e.g. ./dist → $CWD/dist
//   无前缀 → 相对于 cwd

export interface FilesystemConfig {
    /** 额外可写路径（cwd 及子目录默认可写） */
    allowWrite: string[];
    /** 禁止写入的路径 */
    denyWrite: string[];
    /** 禁止读取的路径 */
    denyRead: string[];
}

// ── 网络隔离配置 ────────────────────────────────────────────────

export interface NetworkConfig {
    /** 允许访问的域名列表 */
    allowedDomains: string[];
    /** 是否阻止非白名单域名（true=直接拒绝，false=弹出权限提示） */
    allowManagedDomainsOnly: boolean;
    /** HTTP 代理端口（沙箱外运行） */
    httpProxyPort: number;
    /** SOCKS 代理端口 */
    socksProxyPort: number;
}

// ── Docker 可选配置 ─────────────────────────────────────────────

export interface DockerSandboxOptions {
    image: string;
    pullOnStart: boolean;
    memoryLimit: string;
    cpuLimit: number;
    extraArgs: string[];
}

// ── 主沙箱配置 ──────────────────────────────────────────────────

export interface SandboxConfig {
    /** 是否启用沙箱 */
    enabled: boolean;
    /** 权限模式 */
    permissions: SandboxPermissions;
    /** 偏好策略（auto 选择时优先尝试） */
    preferStrategy: SandboxStrategyType;
    /** 是否允许 dangerouslyDisableSandbox 逃生舱 */
    allowUnsandboxedCommands: boolean;
    /** 不进沙箱的命令前缀（如 docker, watchman） */
    excludedCommands: string[];
    /** 文件系统隔离 */
    filesystem: FilesystemConfig;
    /** 网络隔离 */
    network: NetworkConfig;
    /** 执行超时（ms） */
    timeout: number;
    /** 最大输出（bytes） */
    maxOutput: number;
    /** Docker 可选配置 */
    docker: DockerSandboxOptions;
}

export const defaultSandboxConfig: SandboxConfig = {
    enabled: true,
    permissions: "auto-allow",
    preferStrategy: "native",
    allowUnsandboxedCommands: true,
    excludedCommands: ["docker", "podman", "nerdctl"],
    filesystem: {
        allowWrite: [],
        denyWrite: [
            "~/.ssh",
            "~/.gnupg",
        ],
        denyRead: [
            "~/.aws/credentials",
            "~/.config/gcloud/credentials.db",
            "~/.azure",
        ],
    },
    network: {
        allowedDomains: [
            "registry.npmjs.org",
            "pypi.org",
            "files.pythonhosted.org",
            "crates.io",
            "github.com",
            "raw.githubusercontent.com",
            "api.github.com",
            "objects.githubusercontent.com",
        ],
        allowManagedDomainsOnly: false,
        httpProxyPort: 0,
        socksProxyPort: 0,
    },
    timeout: 30_000,
    maxOutput: 1024 * 1024,
    docker: {
        image: "node:20-slim",
        pullOnStart: false,
        memoryLimit: "512m",
        cpuLimit: 1,
        extraArgs: [],
    },
};

// ── 沙箱执行结果 ────────────────────────────────────────────────

export interface SandboxResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    /** 实际使用的策略 */
    strategy: SandboxStrategyType | "none";
    killed: boolean;
    durationMs: number;
}

// ── 策略接口 ────────────────────────────────────────────────────

export interface SandboxStrategy {
    readonly type: SandboxStrategyType;
    isAvailable(): boolean;
    execute(
        command: string,
        cwd: string,
        config: SandboxConfig,
        signal?: AbortSignal,
    ): Promise<SandboxResult>;
}

// ── 平台检测 ────────────────────────────────────────────────────

export type SandboxPlatform = "macos" | "linux" | "windows" | "unsupported";

export function detectPlatform(): SandboxPlatform {
    switch (process.platform) {
        case "darwin":  return "macos";
        case "linux":   return "linux";
        case "win32":   return "windows";
        default:        return "unsupported";
    }
}

// ── 路径解析（Claude Code 路径前缀约定）────────────────────────

import { resolve } from "node:path";
import { homedir } from "node:os";

export function resolveSandboxPath(p: string, cwd: string): string {
    if (p.startsWith("//")) {
        return p.slice(1);                          // //tmp/build → /tmp/build
    }
    if (p.startsWith("~/")) {
        return resolve(homedir(), p.slice(2));      // ~/.kube → $HOME/.kube
    }
    if (p.startsWith("./") || !p.startsWith("/")) {
        return resolve(cwd, p);                     // ./dist → $CWD/dist
    }
    return resolve(cwd, p);                         // /build → $CWD/build (relative to settings dir = cwd)
}
