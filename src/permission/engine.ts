// ── 权限决策引擎 ─────────────────────────────────────────────────
// 决策树：Mode → Safety Floor → Rule Store → Tool 属性 → Default
//
// 决策流程：
//   1. bypassPermissions 模式 → ALLOW
//   2. denyAll / plan 模式 → DENY（只读除外）
//   3. 安全底线检查（敏感路径、危险命令）→ DENY / ASK(high)
//   4. 规则存储匹配 → ALLOW / DENY
//   5. isReadOnly 工具 → ALLOW
//   6. acceptEdits 模式 + 文件工具 → ALLOW
//   7. default 模式 → ASK

import type {
    PermissionMode,
    PermissionQuery,
    PermissionCheckResult,
    RiskLevel,
    ApprovalResponse,
} from "./types.js";
import { RuleStore } from "./rules.js";
import type { CustomSafetyRule } from "./types.js";
import {
    checkPathSensitivity,
    checkCommandSafety,
    isInsideWorkspace,
    SafetyRegistry,
} from "./paths.js";

export class PermissionEngine {
    private mode: PermissionMode = "default";
    private _sandboxAutoAllow = false;
    private _willSandbox: ((command: string) => boolean) | null = null;
    private _planAutoApprovePatterns: Set<string> = new Set();

    constructor(
        private readonly rules: RuleStore,
        private readonly cwd: string,
    ) {}

    /**
     * 配置沙箱与权限引擎的集成（对齐 Claude Code 双模式）。
     * @param autoAllow  sandbox.permissions = "auto-allow" 时为 true
     * @param willSandbox  判断某命令是否会在沙箱中执行的函数
     */
    configureSandbox(autoAllow: boolean, willSandbox: (command: string) => boolean): void {
        this._sandboxAutoAllow = autoAllow;
        this._willSandbox = willSandbox;
    }

    get sandboxAutoAllow(): boolean {
        return this._sandboxAutoAllow;
    }

    // ── 主入口：检查权限 ────────────────────────────────────────

    check(query: PermissionQuery): PermissionCheckResult {
        // Layer 1：全局模式
        if (this.mode === "bypassPermissions") {
            return allow("Mode: bypassPermissions", "low");
        }

        if (this.mode === "denyAll") {
            return deny("Mode: denyAll — all operations blocked", "high");
        }

        if (this.mode === "plan" && !query.isReadOnly) {
            return deny("Mode: plan — write operations blocked", "moderate",
                "The user is in plan mode. Write operations are not permitted. Describe what you would do instead.");
        }

        // Layer 1.5：Plan 管理工具自动放行
        const planTools = ["plan", "plan_approve", "plan_step_done", "plan_status"];
        if (planTools.includes(query.toolName)) {
            return allow("Plan management tool: auto-approved", "low");
        }

        // Layer 2：安全底线（不可被规则覆盖）
        const safetyResult = this.checkSafetyFloor(query);
        if (safetyResult) return safetyResult;

        // Layer 2.5：沙箱自动放行（对齐 Claude Code auto-allow 模式）
        // 条件：sandbox.permissions = "auto-allow" + 命令会在沙箱中执行
        // 效果：安全底线通过后的 bash 命令免审批
        if (this._sandboxAutoAllow && query.toolName === "bash" && query.command) {
            const willBeSandboxed = this._willSandbox?.(query.command) ?? false;
            if (willBeSandboxed) {
                return allow("Sandbox auto-allow: bash command sandboxed", "low");
            }
        }

        // Layer 3：规则存储
        const ruleResult = this.checkRules(query);
        if (ruleResult) return ruleResult;

        // Layer 3.5：会话级审批记忆（plan 执行加速）
        if (this.matchesApprovedPattern(query)) {
            return allow("Session auto-approve: previously approved pattern", "low");
        }

        // Layer 4：工具属性
        if (query.isReadOnly) {
            return allow("Read-only tool: auto-approved", "low");
        }

        // Layer 5：模式级默认行为
        if (this.mode === "acceptEdits") {
            const isFileOp = ["write_file", "edit_file"].includes(query.toolName);
            if (isFileOp && query.filePath && isInsideWorkspace(query.filePath, this.cwd)) {
                return allow("Mode: acceptEdits — file edit in workspace", "low");
            }
        }

        // Layer 6：默认 → 询问用户
        return ask(
            `Tool "${query.toolName}" requires approval`,
            this.assessRisk(query),
        );
    }

    // ── Layer 2：安全底线 ───────────────────────────────────────

    private checkSafetyFloor(query: PermissionQuery): PermissionCheckResult | null {
        // Bash 命令安全检查
        if (query.command) {
            const cmdSafety = checkCommandSafety(query.command);
            if (cmdSafety.isDangerous) {
                return deny(
                    `Dangerous command detected: ${cmdSafety.category}`,
                    "high",
                    `This command was blocked for safety: ${cmdSafety.category}. Please use a safer alternative.`,
                );
            }
        }

        // 文件路径敏感检查
        if (query.filePath) {
            const pathSensitivity = checkPathSensitivity(query.filePath, this.cwd);
            if (pathSensitivity.isSensitive && pathSensitivity.risk === "high" && !query.isReadOnly) {
                return ask(
                    `Sensitive path: ${pathSensitivity.category}`,
                    "high",
                );
            }
        }

        return null;
    }

    // ── Layer 3：规则匹配 ───────────────────────────────────────

    private checkRules(query: PermissionQuery): PermissionCheckResult | null {
        const rule = this.rules.findMatchingRule(
            query.toolName,
            query.filePath,
            query.command,
            this.cwd,
        );

        if (!rule) return null;

        if (rule.action === "deny") {
            return deny(
                `Rule ${rule.id}: deny ${rule.toolName}`,
                "moderate",
                `This operation was denied by permission rule: ${rule.id}`,
            );
        }

        return allow(`Rule ${rule.id}: allow ${rule.toolName}`, "low");
    }

    // ── 风险评估 ────────────────────────────────────────────────

    private assessRisk(query: PermissionQuery): RiskLevel {
        // bash 命令默认 moderate
        if (query.toolName === "bash") {
            if (query.command) {
                const safety = checkCommandSafety(query.command);
                if (safety.isSafe) return "low";
                if (safety.isDangerous) return "high";
            }
            return "moderate";
        }

        // 写操作 + 工作区外 = high
        if (!query.isReadOnly && query.filePath && !isInsideWorkspace(query.filePath, this.cwd)) {
            return "high";
        }

        // 写操作在工作区内 = moderate
        if (!query.isReadOnly) return "moderate";

        return "low";
    }

    // ── 审批后处理 ──────────────────────────────────────────────
    // 用户在 UI 上做出审批决定后调用此方法

    handleApproval(query: PermissionQuery, response: ApprovalResponse): void {
        // Always remember approval patterns in session for plan acceleration
        if (response.action === "allow") {
            const pattern = this.buildApprovalPattern(query);
            if (pattern) this._planAutoApprovePatterns.add(pattern);
        }

        if (!response.persist) return;

        this.rules.addRule(
            response.action,
            query.toolName,
            "session",
            {
                pathPattern: query.filePath ? inferPathPattern(query.filePath) : undefined,
                commandPrefix: query.command ? inferCommandPrefix(query.command) : undefined,
            },
        );
    }

    private buildApprovalPattern(query: PermissionQuery): string | null {
        if (query.toolName === "bash" && query.command) {
            const prefix = query.command.trim().split(/\s+/)[0];
            const hasDangerouslyDisable = query.args?.dangerouslyDisableSandbox === true;
            return `bash:${prefix}${hasDangerouslyDisable ? ":unsandboxed" : ""}`;
        }
        if (query.toolName === "write_file" || query.toolName === "edit_file") {
            return `${query.toolName}:workspace`;
        }
        return null;
    }

    private matchesApprovedPattern(query: PermissionQuery): boolean {
        if (this._planAutoApprovePatterns.size === 0) return false;

        if (query.toolName === "bash" && query.command) {
            const prefix = query.command.trim().split(/\s+/)[0];
            const hasDangerouslyDisable = query.args?.dangerouslyDisableSandbox === true;
            if (hasDangerouslyDisable && this._planAutoApprovePatterns.has(`bash:${prefix}:unsandboxed`)) return true;
            if (this._planAutoApprovePatterns.has(`bash:${prefix}`)) return true;
        }
        if ((query.toolName === "write_file" || query.toolName === "edit_file") &&
            query.filePath && isInsideWorkspace(query.filePath, this.cwd)) {
            if (this._planAutoApprovePatterns.has(`${query.toolName}:workspace`)) return true;
        }
        return false;
    }

    clearPlanApprovalPatterns(): void {
        this._planAutoApprovePatterns.clear();
    }

    // ── 模式管理 ────────────────────────────────────────────────

    getMode(): PermissionMode { return this.mode; }

    setMode(mode: PermissionMode): void { this.mode = mode; }

    cycleMode(): PermissionMode {
        const cycle: PermissionMode[] = ["default", "acceptEdits", "plan", "bypassPermissions"];
        const idx = cycle.indexOf(this.mode);
        this.mode = cycle[(idx + 1) % cycle.length];
        return this.mode;
    }

    // ── 自定义安全规则扩展 ──────────────────────────────────────

    get safetyRegistry(): SafetyRegistry {
        return SafetyRegistry.instance;
    }

    registerSafetyRule(rule: CustomSafetyRule): void {
        SafetyRegistry.instance.register(rule);
    }

    registerSafetyRules(rules: CustomSafetyRule[]): void {
        SafetyRegistry.instance.registerBatch(rules);
    }

    loadSafetyRulesFromConfig(configRules: CustomSafetyRule[]): { loaded: number; errors: string[] } {
        const errors: string[] = [];
        let loaded = 0;

        for (const rule of configRules) {
            try {
                new RegExp(rule.pattern);
            } catch (e) {
                errors.push(`Invalid regex in rule "${rule.category}": ${rule.pattern}`);
                continue;
            }

            if (!["dangerous_command", "sensitive_path", "safe_command"].includes(rule.type)) {
                errors.push(`Unknown rule type "${rule.type}" in "${rule.category}"`);
                continue;
            }

            SafetyRegistry.instance.register(rule);
            loaded++;
        }

        return { loaded, errors };
    }

    getSafetyStats() {
        return SafetyRegistry.instance.stats;
    }

    // ── 从工具调用中提取权限查询 ─────────────────────────────────

    static buildQuery(
        toolName: string,
        args: Record<string, unknown>,
        isReadOnly: boolean,
        cwd: string,
    ): PermissionQuery {
        const filePath = (args.path ?? args.file_path ?? args.file) as string | undefined;
        const command = (args.command ?? args.cmd) as string | undefined;

        return {
            toolName,
            args,
            isReadOnly,
            filePath,
            command,
            cwd,
        };
    }
}

// ── 工厂函数 ────────────────────────────────────────────────────

function allow(reason: string, riskLevel: RiskLevel): PermissionCheckResult {
    return { decision: "allow", reason, riskLevel };
}

function deny(reason: string, riskLevel: RiskLevel, denyMessage?: string): PermissionCheckResult {
    return { decision: "deny", reason, riskLevel, denyMessage };
}

function ask(reason: string, riskLevel: RiskLevel): PermissionCheckResult {
    return { decision: "ask", reason, riskLevel };
}

// ── 规则推断 ────────────────────────────────────────────────────

function inferPathPattern(filePath: string): string {
    const parts = filePath.split("/");
    if (parts.length >= 2) {
        return parts.slice(0, -1).join("/") + "/**";
    }
    return "**";
}

function inferCommandPrefix(command: string): string {
    const firstWord = command.trim().split(/\s+/)[0];
    return firstWord + " *";
}
