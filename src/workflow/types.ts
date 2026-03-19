// ── Workflow 系统类型定义 ─────────────────────────────────────────
// Workflow 定义一个场景下 Agent 的行为模式：
//   - 需要哪些工具
//   - 使用哪些 Prompt 模块
//   - 可选的 Prompt 覆盖
//   - 生命周期钩子

// ── Workflow 定义 ────────────────────────────────────────────────

export interface WorkflowDef {
    /** 工作流唯一标识（如 "code", "research", "data-analysis"）*/
    name: string;

    /** 人类可读描述 */
    description: string;

    /** 该工作流需要的工具列表（启动时校验） */
    requiredTools: string[];

    /** 该工作流激活的 Prompt 模块 id 列表 */
    promptModules: string[];

    /** Prompt 覆盖：按模块 id 替换部分内容 */
    promptOverrides?: Record<string, string>;

    /** 该工作流额外注入的 PromptContext 字段 */
    extraContext?: Record<string, string>;

    /** 工作流激活时的钩子 */
    onActivate?(ctx: WorkflowContext): void | Promise<void>;

    /** 工作流停用时的钩子 */
    onDeactivate?(): void | Promise<void>;
}

// ── Workflow 上下文 ──────────────────────────────────────────────
// 传给 onActivate 钩子，提供运行时访问能力。

export interface WorkflowContext {
    cwd: string;
    getConfig(): Record<string, unknown>;
    getToolNames(): string[];
}
