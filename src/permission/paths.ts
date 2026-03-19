// ── 路径安全检测 ─────────────────────────────────────────────────
// 1. 工作区边界检查（路径逃逸防护）
// 2. 敏感路径检测（系统文件、密钥、配置）
// 3. glob 模式匹配
// 4. SafetyRegistry：支持外部注册自定义规则

import { resolve, relative, isAbsolute } from "node:path";
import { realpathSync } from "node:fs";
import type { CustomSafetyRule } from "./types.js";

// ── 工作区边界 ──────────────────────────────────────────────────

export function isInsideWorkspace(filePath: string, cwd: string): boolean {
    try {
        const resolved = resolveRealPath(filePath, cwd);
        const workspaceReal = resolveRealPath(cwd, cwd);
        return resolved.startsWith(workspaceReal + "/") || resolved === workspaceReal;
    } catch {
        return false;
    }
}

function resolveRealPath(p: string, cwd: string): string {
    const abs = isAbsolute(p) ? p : resolve(cwd, p);
    try {
        return realpathSync(abs);
    } catch {
        return abs;
    }
}

// ── 敏感路径 ────────────────────────────────────────────────────

const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; category: string; risk: "high" | "moderate" }> = [
    // 密钥/凭证
    { pattern: /\.env($|\.)/, category: "env-file", risk: "high" },
    { pattern: /\.pem$/, category: "certificate", risk: "high" },
    { pattern: /\.key$/, category: "private-key", risk: "high" },
    { pattern: /credentials?\.(json|yaml|yml|toml)$/i, category: "credentials", risk: "high" },
    { pattern: /secrets?\.(json|yaml|yml|toml)$/i, category: "secrets", risk: "high" },
    { pattern: /\.ssh\//, category: "ssh", risk: "high" },
    { pattern: /\.gnupg\//, category: "gpg", risk: "high" },
    { pattern: /\.aws\//, category: "aws-config", risk: "high" },
    { pattern: /\.kube\//, category: "kube-config", risk: "high" },

    // 系统目录
    { pattern: /^\/etc\//, category: "system-etc", risk: "high" },
    { pattern: /^\/usr\//, category: "system-usr", risk: "moderate" },
    { pattern: /^\/var\//, category: "system-var", risk: "moderate" },
    { pattern: /^\/System\//, category: "macos-system", risk: "high" },

    // 版本控制内部
    { pattern: /\.git\//, category: "git-internals", risk: "moderate" },

    // 包管理 lockfile（写入可能有供应链风险）
    { pattern: /package-lock\.json$/, category: "lockfile", risk: "moderate" },
    { pattern: /yarn\.lock$/, category: "lockfile", risk: "moderate" },
    { pattern: /pnpm-lock\.yaml$/, category: "lockfile", risk: "moderate" },
];

export interface SensitivityResult {
    isSensitive: boolean;
    category?: string;
    risk: "low" | "moderate" | "high";
}

export function checkPathSensitivity(filePath: string, cwd: string): SensitivityResult {
    const resolved = isAbsolute(filePath) ? filePath : resolve(cwd, filePath);

    const allPatterns = [
        ...SENSITIVE_PATTERNS,
        ...SafetyRegistry.instance.getCustomSensitivePaths(),
    ];

    for (const { pattern, category, risk } of allPatterns) {
        if (pattern.test(resolved) || pattern.test(filePath)) {
            return { isSensitive: true, category, risk };
        }
    }

    if (!isInsideWorkspace(filePath, cwd)) {
        return { isSensitive: true, category: "outside-workspace", risk: "moderate" };
    }

    return { isSensitive: false, risk: "low" };
}

// ── Bash 命令安全检测 ────────────────────────────────────────────

const BUILTIN_DANGEROUS_COMMANDS: Array<{ pattern: RegExp; category: string }> = [
    // ── 系统级破坏 ──
    { pattern: /\brm\s+(-[^\s]*[rRf]|-[rRf])\b/, category: "destructive-rm" },
    { pattern: /\brm\s+(-[^\s]*\s+)*\//, category: "destructive-rm-root" },
    { pattern: /\bsudo\b/, category: "sudo" },
    { pattern: /\bchmod\s+[0-7]*7[0-7]*/, category: "chmod-world-writable" },
    { pattern: /\bchown\b/, category: "chown" },
    { pattern: /\bdd\b/, category: "dd" },
    { pattern: /\bmkfs\b/, category: "mkfs" },
    { pattern: /\bshutdown\b/, category: "shutdown" },
    { pattern: /\breboot\b/, category: "reboot" },
    { pattern: /\bkill\s+-9\b/, category: "force-kill" },
    { pattern: /\bkillall\b/, category: "killall" },

    // ── 远程执行 / 注入 ──
    { pattern: /\bcurl\b.*\|\s*(ba)?sh/, category: "pipe-to-shell" },
    { pattern: /\bwget\b.*\|\s*(ba)?sh/, category: "pipe-to-shell" },
    { pattern: />\s*\/dev\//, category: "dev-write" },
    { pattern: /\beval\b/, category: "eval" },
    { pattern: /\bnc\s+-l/, category: "netcat-listen" },

    // ── npm / Node 破坏性操作 ──
    { pattern: /\bnpm\s+unpublish\b/, category: "npm-unpublish" },
    { pattern: /\bnpm\s+deprecate\b/, category: "npm-deprecate" },
    { pattern: /\bnpm\s+cache\s+clean\b/, category: "npm-cache-clean" },
    { pattern: /\bnpx?\s+rimraf\b/, category: "rimraf" },
    { pattern: /\bnpm\s+exec\b.*\brm\b/, category: "npm-exec-rm" },

    // ── Python 破坏性操作 ──
    { pattern: /\bpip\s+uninstall\s+(-y\s+)?\./, category: "pip-uninstall-all" },
    { pattern: /\bpython[3]?\s+-c\s+.*\bos\.remove\b/, category: "py-os-remove" },
    { pattern: /\bpython[3]?\s+-c\s+.*\bshutil\.rmtree\b/, category: "py-shutil-rmtree" },
    { pattern: /\bpython[3]?\s+-c\s+.*\bos\.system\b/, category: "py-os-system" },
    { pattern: /\bpython[3]?\s+-c\s+.*\bsubprocess\b/, category: "py-subprocess" },

    // ── Git 破坏性操作 ──
    { pattern: /\bgit\s+push\s+.*--force\b/, category: "git-force-push" },
    { pattern: /\bgit\s+push\s+-f\b/, category: "git-force-push" },
    { pattern: /\bgit\s+reset\s+--hard\b/, category: "git-hard-reset" },
    { pattern: /\bgit\s+clean\s+-[^\s]*f/, category: "git-clean-force" },
    { pattern: /\bgit\s+checkout\s+--\s+\./, category: "git-discard-all" },

    // ── Docker 破坏性操作 ──
    { pattern: /\bdocker\s+(rm|rmi)\s+-f\b/, category: "docker-force-remove" },
    { pattern: /\bdocker\s+system\s+prune\b/, category: "docker-prune" },
    { pattern: /\bdocker\s+volume\s+rm\b/, category: "docker-volume-rm" },

    // ── 数据库破坏性操作 ──
    { pattern: /\bDROP\s+(DATABASE|TABLE|SCHEMA)\b/i, category: "sql-drop" },
    { pattern: /\bTRUNCATE\s+TABLE\b/i, category: "sql-truncate" },
    { pattern: /\bDELETE\s+FROM\s+\w+\s*;?\s*$/i, category: "sql-delete-all" },

    // ── 通用文件删除模式 ──
    { pattern: /\bfind\s+.*-delete\b/, category: "find-delete" },
    { pattern: /\bfind\s+.*-exec\s+rm\b/, category: "find-exec-rm" },
    { pattern: />\s+[^\s]+\.(env|key|pem|json|ya?ml|toml|conf)\s*$/, category: "overwrite-config" },
];

const BUILTIN_SAFE_COMMAND_PREFIXES = new Set([
    // 文件查看
    "ls", "cat", "head", "tail", "wc", "echo", "pwd", "whoami",
    "date", "uname", "which", "type", "file", "stat", "du", "df",
    "tree", "less", "more", "realpath", "dirname", "basename",
    // 搜索
    "find", "grep", "rg", "ag", "awk", "sed", "sort", "uniq", "tr",
    "diff", "comm", "cut", "xargs echo",
    // Git 只读
    "git status", "git log", "git diff", "git branch", "git tag",
    "git show", "git remote", "git stash list", "git rev-parse",
    // Node/npm 只读
    "node --version", "node -v", "node -e", "node -p",
    "npm --version", "npm list", "npm ls", "npm view", "npm info",
    "npm outdated", "npm audit", "npm whoami", "npm config list",
    "npx tsc --noEmit", "npx vitest",
    // Python 只读
    "python --version", "python -V", "python3 --version",
    "pip list", "pip show", "pip freeze", "pip --version",
    // 系统信息
    "env", "printenv", "id", "groups", "hostname", "uptime",
    "free", "top -b -n 1", "ps aux", "lsof",
]);

export interface CommandSafetyResult {
    isSafe: boolean;
    isDangerous: boolean;
    category?: string;
}

export function checkCommandSafety(command: string): CommandSafetyResult {
    const trimmed = command.trim();

    const allDangerous = [
        ...BUILTIN_DANGEROUS_COMMANDS,
        ...SafetyRegistry.instance.getCustomDangerousCommands(),
    ];

    for (const { pattern, category } of allDangerous) {
        if (pattern.test(trimmed)) {
            return { isSafe: false, isDangerous: true, category };
        }
    }

    const customSafePrefixes = SafetyRegistry.instance.getCustomSafePrefixes();

    for (const prefix of BUILTIN_SAFE_COMMAND_PREFIXES) {
        if (trimmed === prefix || trimmed.startsWith(prefix + " ")) {
            return { isSafe: true, isDangerous: false };
        }
    }
    for (const prefix of customSafePrefixes) {
        if (trimmed === prefix || trimmed.startsWith(prefix + " ")) {
            return { isSafe: true, isDangerous: false };
        }
    }

    return { isSafe: false, isDangerous: false };
}

// ── Glob 匹配（简化版）─────────────────────────────────────────

export function matchGlob(pattern: string, filePath: string, cwd: string): boolean {
    const rel = isAbsolute(filePath)
        ? relative(cwd, filePath)
        : filePath;

    const regex = globToRegex(pattern);
    return regex.test(rel) || regex.test(filePath);
}

function globToRegex(glob: string): RegExp {
    let re = glob
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "§DOUBLESTAR§")
        .replace(/\*/g, "[^/]*")
        .replace(/§DOUBLESTAR§/g, ".*")
        .replace(/\?/g, "[^/]");

    return new RegExp(`^${re}$`);
}

// ── SafetyRegistry：可扩展安全规则注册表 ─────────────────────────
// 支持两种扩展方式:
//   1. 编程式：SafetyRegistry.instance.register(...)
//   2. 配置式：.agent/config.toml → [[safety_rules]]

type RegisteredPattern = { pattern: RegExp; category: string; risk: "moderate" | "high" };

export class SafetyRegistry {
    static readonly instance = new SafetyRegistry();

    private readonly dangerousCommands: RegisteredPattern[] = [];
    private readonly sensitivePathPatterns: RegisteredPattern[] = [];
    private readonly safePrefixes: Set<string> = new Set();

    private constructor() {}

    register(rule: CustomSafetyRule): void {
        const regex = new RegExp(rule.pattern);
        const risk = rule.risk ?? "high";

        switch (rule.type) {
            case "dangerous_command":
                this.dangerousCommands.push({ pattern: regex, category: rule.category, risk });
                break;
            case "sensitive_path":
                this.sensitivePathPatterns.push({ pattern: regex, category: rule.category, risk });
                break;
            case "safe_command":
                this.safePrefixes.add(rule.pattern);
                break;
        }
    }

    registerBatch(rules: CustomSafetyRule[]): void {
        for (const rule of rules) {
            this.register(rule);
        }
    }

    getCustomDangerousCommands(): Array<{ pattern: RegExp; category: string }> {
        return this.dangerousCommands;
    }

    getCustomSensitivePaths(): RegisteredPattern[] {
        return this.sensitivePathPatterns;
    }

    getCustomSafePrefixes(): Set<string> {
        return this.safePrefixes;
    }

    clear(): void {
        this.dangerousCommands.length = 0;
        this.sensitivePathPatterns.length = 0;
        this.safePrefixes.clear();
    }

    get stats() {
        return {
            dangerousCommands: BUILTIN_DANGEROUS_COMMANDS.length + this.dangerousCommands.length,
            sensitivePathPatterns: this.sensitivePathPatterns.length,
            safePrefixes: BUILTIN_SAFE_COMMAND_PREFIXES.size + this.safePrefixes.size,
            customCount: this.dangerousCommands.length + this.sensitivePathPatterns.length + this.safePrefixes.size,
        };
    }
}
