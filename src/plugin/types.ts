// ── Plugin 系统类型定义 ──────────────────────────────────────────
// Plugin 是 agent-kit 的第一公民。所有能力扩展都通过 Plugin 注入。

import type { ReactNode } from "react";

// ── Plugin 接口 ──────────────────────────────────────────────────

export interface Plugin {
    name: string;
    version: string;
    description?: string;

    setup(ctx: PluginContext): void | Promise<void>;
    teardown?(): void | Promise<void>;
}

// ── Plugin Context ───────────────────────────────────────────────
// setup() 接收的上下文对象，提供所有注册 API。

export interface PluginContext {
    // 工具
    registerTool(tool: ToolRegistration): void;

    // LLM Provider
    registerProvider(provider: ProviderRegistration): void;

    // Loader
    registerLoader(loader: LoaderRegistration): void;

    // Prompt 模块
    registerPromptModule(module: PromptModuleRegistration): void;

    // 工作流
    registerWorkflow(workflow: WorkflowRegistration): void;

    // 子代理类型
    registerSubagentType(type: SubagentTypeRegistration): void;

    // UI 插槽
    registerToolRenderer(renderer: ToolRendererRegistration): void;
    registerPermissionRenderer(renderer: PermissionRendererRegistration): void;
    registerContentRenderer(renderer: ContentRendererRegistration): void;
    registerMarkdownExtension(extension: MarkdownExtensionRegistration): void;
    registerInputMode(mode: InputModeRegistration): void;
    registerStatusBarItem(item: StatusBarItemRegistration): void;

    // 事件
    on(event: string, handler: (...args: unknown[]) => void): void;

    // 只读访问
    getConfig(): Record<string, unknown>;
    getLogger(): Logger;
}

// ── 各类注册对象的 placeholder 类型 ──────────────────────────────
// 具体类型在各自模块中定义（tool/types.ts、provider/types.ts 等）。
// 这里用轻量接口避免循环依赖。

export interface ToolRegistration {
    name: string;
    description: string;
    inputSchema: unknown;
    isReadOnly: boolean;
    execute(input: unknown, ctx: unknown): Promise<unknown>;
}

export interface ProviderRegistration {
    name: string;
    chatCompletion(...args: unknown[]): AsyncGenerator<unknown>;
    close(): Promise<void>;
}

export interface LoaderRegistration {
    name: string;
    test: RegExp | ((resource: unknown) => boolean);
    load(resource: unknown, ctx: unknown): Promise<unknown>;
}

export interface PromptModuleRegistration {
    id: string;
    priority: number;
    render(ctx: unknown): string;
}

export interface WorkflowRegistration {
    name: string;
    description: string;
    requiredTools: string[];
    promptModules: string[];
}

export interface SubagentTypeRegistration {
    name: string;
    description: string;
}

// ── UI 插槽注册类型 ──────────────────────────────────────────────

export interface ToolRendererRegistration {
    toolName: string;
    renderToolUse?(args: Record<string, unknown>): ReactNode;
    renderToolResult?(result: unknown): ReactNode;
    renderResultForAssistant?(result: unknown): string;
}

export interface PermissionRendererRegistration {
    toolName: string;
    renderPermissionBody(args: Record<string, unknown>, theme: unknown): ReactNode;
    getApprovalOptions?(args: Record<string, unknown>): Array<{ label: string; value: string }>;
    assessRisk?(args: Record<string, unknown>): "low" | "moderate" | "high";
}

export interface ContentRendererRegistration {
    blockType: string;
    render(block: unknown, theme: unknown): ReactNode;
}

export interface MarkdownExtensionRegistration {
    name: string;
    pattern: RegExp;
    parse(match: RegExpMatchArray): { type: string; raw: string; data: Record<string, unknown> };
    render(token: unknown, theme: unknown): ReactNode;
}

export interface InputModeRegistration {
    name: string;
    prefix: string;
    borderColor(theme: unknown): string;
    label?: string;
    onSubmit(text: string, ctx: unknown): void | Promise<void>;
    getCompletions?(partial: string): Array<{ label: string; value: string }>;
}

export interface StatusBarItemRegistration {
    id: string;
    priority: number;
    render(ctx: unknown, theme: unknown): ReactNode;
}

// ── Logger ───────────────────────────────────────────────────────

export interface Logger {
    debug(message: string, ...args: unknown[]): void;
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
}
