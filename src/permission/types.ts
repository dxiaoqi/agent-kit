// ── 权限系统类型定义 ─────────────────────────────────────────────
// 五层模型：Mode → Matcher → Store → Engine → UI

// ── 权限模式 ─────────────────────────────────────────────────────
// 全局模式决定基线行为，可通过 /mode 命令或配置切换。

export type PermissionMode =
    | "default"            // 写操作需确认，读操作放行
    | "acceptEdits"        // 文件编辑自动放行，bash 仍需确认
    | "plan"               // 只读模式，所有写操作拒绝
    | "bypassPermissions"  // 信任模式，全部放行（危险）
    | "denyAll";           // 锁定模式，全部拒绝

// ── 决策结果 ─────────────────────────────────────────────────────

export type PermissionDecision = "allow" | "deny" | "ask";

export interface PermissionCheckResult {
    decision: PermissionDecision;
    reason: string;
    riskLevel: RiskLevel;
    /** 若 decision=deny，返回给 LLM 的拒绝消息 */
    denyMessage?: string;
}

export type RiskLevel = "low" | "moderate" | "high";

// ── 规则定义 ─────────────────────────────────────────────────────
// 规则由用户通过配置/交互创建，引擎按优先级匹配。

export type RuleAction = "allow" | "deny";

export interface PermissionRule {
    id: string;
    action: RuleAction;
    /** 匹配的工具名（"*" 表示全部） */
    toolName: string;
    /** glob 模式匹配路径参数（如 "src/**"） */
    pathPattern?: string;
    /** bash 命令前缀匹配（如 "npm *"） */
    commandPrefix?: string;
    /** 规则来源与生命周期 */
    scope: RuleScope;
    createdAt: number;
}

export type RuleScope =
    | "session"    // 仅本次会话有效（内存）
    | "config";    // 来自 config.toml，只读（需手动编辑配置文件修改）

// ── 审批响应 ─────────────────────────────────────────────────────

export type ApprovalResponse =
    | { action: "allow"; persist: RuleScope | null }
    | { action: "deny";  persist: RuleScope | null };

// ── 权限上下文（传给引擎的完整信息）─────────────────────────────

export interface PermissionQuery {
    toolName: string;
    args: Record<string, unknown>;
    isReadOnly: boolean;
    /** 解析出的文件路径（edit_file → args.path）*/
    filePath?: string;
    /** 解析出的 bash 命令 */
    command?: string;
    /** 当前工作目录 */
    cwd: string;
}

// ── 自定义安全规则（外置扩展）──────────────────────────────────

export interface CustomSafetyRule {
    /** 正则表达式字符串（会被编译为 RegExp）*/
    pattern: string;
    /** 分类名称（用于日志和 UI 展示）*/
    category: string;
    /** 规则类型 */
    type: "dangerous_command" | "sensitive_path" | "safe_command";
    /** 风险等级（仅 dangerous_command / sensitive_path 有效）*/
    risk?: "moderate" | "high";
}
