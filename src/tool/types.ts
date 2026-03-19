// ── 工具系统类型定义 ─────────────────────────────────────────────
// ToolDef 是工具的完整定义，包含 Zod schema、描述（= prompt）、执行逻辑。
// ToolRegistry 管理注册和查找。

import type { z } from "zod";

// ── Tool Result ──────────────────────────────────────────────────

export type ToolResult =
    | { success: true;  output: string }
    | { success: false; error: string };

// ── Tool Context ─────────────────────────────────────────────────
// 执行工具时传入的上下文，提供环境信息和辅助能力。

export interface ToolContext {
    cwd: string;
    abortSignal?: AbortSignal;
}

// ── Tool Definition ──────────────────────────────────────────────

export interface ToolDef<TInput = Record<string, unknown>> {
    name: string;

    /** 工具描述——这就是给 LLM 看的 prompt */
    description: string;

    /** Zod schema，用于输入校验 + 自动生成 JSON Schema */
    inputSchema: z.ZodType<TInput>;

    /** 只读工具可以被缓存、不需要权限确认 */
    isReadOnly: boolean;

    /** 执行工具 */
    execute(input: TInput, ctx: ToolContext): Promise<ToolResult>;
}

// ── JSON Schema 转换 ─────────────────────────────────────────────
// 用于将 Zod schema 转为 LLM API 需要的 JSON Schema 格式。

export interface ToolJsonSchema {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}
