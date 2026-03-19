// ── UI 插槽类型定义 ──────────────────────────────────────────────
// 六种 UI 插槽，Plugin 通过 PluginContext 注册到 UIRegistry。

import type { ReactNode } from "react";
import type { Theme } from "./theme.js";

export interface ToolRendererDef {
    toolName: string;
    renderToolUse?(args: Record<string, unknown>, theme: Theme): ReactNode;
    renderToolResult?(result: { success: boolean; output?: string; error?: string }, theme: Theme): ReactNode;
    renderResultForAssistant?(result: { success: boolean; output?: string; error?: string }): string;
}

export interface PermissionRendererDef {
    toolName: string;
    renderPermissionBody(args: Record<string, unknown>, theme: Theme): ReactNode;
    getApprovalOptions?(args: Record<string, unknown>): Array<{ label: string; value: string }>;
    assessRisk?(args: Record<string, unknown>): "low" | "moderate" | "high";
}

export interface ContentRendererDef {
    blockType: string;
    render(block: Record<string, unknown>, theme: Theme): ReactNode;
}

export interface MarkdownExtensionDef {
    name: string;
    pattern: RegExp;
    parse(match: RegExpMatchArray): { type: string; raw: string; data: Record<string, unknown> };
    render(token: { type: string; raw: string; data: Record<string, unknown> }, theme: Theme): ReactNode;
}

export interface InputModeDef {
    name: string;
    prefix: string;
    borderColor(theme: Theme): string;
    label?: string;
    onSubmit(text: string, ctx: { agent: unknown }): void | Promise<void>;
    getCompletions?(partial: string): Array<{ label: string; value: string }>;
}

export interface StatusBarItemDef {
    id: string;
    priority: number;
    render(ctx: { getState: <T>(key: string) => T | undefined }, theme: Theme): ReactNode;
}
