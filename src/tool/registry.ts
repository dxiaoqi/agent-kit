// ── ToolRegistry ─────────────────────────────────────────────────
// 工具的注册中心：注册、查找、校验、执行、输出截断。

import { z } from "zod";
import type { ToolDef, ToolResult, ToolContext, ToolJsonSchema } from "./types.js";

export class ToolRegistry {
    private readonly tools = new Map<string, ToolDef>();

    // ── 注册 ────────────────────────────────────────────────────

    register(tool: ToolDef): void {
        this.tools.set(tool.name, tool);
    }

    // ── 查询 ────────────────────────────────────────────────────

    get(name: string): ToolDef | undefined {
        return this.tools.get(name);
    }

    has(name: string): boolean {
        return this.tools.has(name);
    }

    list(): string[] {
        return Array.from(this.tools.keys());
    }

    // ── 获取所有工具的 JSON Schema（发给 LLM）─────────────────

    getSchemas(): ToolJsonSchema[] {
        return Array.from(this.tools.values()).map(tool => ({
            name: tool.name,
            description: tool.description,
            parameters: zodToJsonSchema(tool.inputSchema),
        }));
    }

    // ── 执行工具（含输入校验 + 输出截断）─────────────────────

    async execute(
        name: string,
        rawInput: unknown,
        ctx: ToolContext,
    ): Promise<ToolResult> {
        const tool = this.tools.get(name);
        if (!tool) {
            return { success: false, error: `Unknown tool: ${name}` };
        }

        // 输入校验
        const parsed = tool.inputSchema.safeParse(rawInput);
        if (!parsed.success) {
            return {
                success: false,
                error: `Invalid input for ${name}: ${parsed.error.message}`,
            };
        }

        try {
            const result = await tool.execute(parsed.data, ctx);

            // 输出截断
            if (result.success) {
                result.output = normalizeToSize(result.output, 30_000);
            }

            return result;
        } catch (err) {
            return {
                success: false,
                error: `Tool ${name} failed: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }
}

// ── Zod → JSON Schema 简易转换 ──────────────────────────────────
// 处理常用的 Zod 类型。Zod v3 没有内建 toJsonSchema，我们手动实现核心子集。

function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
    return zodTypeToJson(schema);
}

function zodTypeToJson(schema: z.ZodType): Record<string, unknown> {
    const def = (schema as any)._def;

    if (!def) return { type: "object" };

    const typeName: string = def.typeName ?? "";

    switch (typeName) {
        case "ZodString":
            return withDescription(def, { type: "string" });

        case "ZodNumber":
            return withDescription(def, { type: "number" });

        case "ZodBoolean":
            return withDescription(def, { type: "boolean" });

        case "ZodArray":
            return withDescription(def, {
                type: "array",
                items: zodTypeToJson(def.type),
            });

        case "ZodEnum":
            return withDescription(def, {
                type: "string",
                enum: def.values,
            });

        case "ZodOptional":
            return zodTypeToJson(def.innerType);

        case "ZodDefault":
            return zodTypeToJson(def.innerType);

        case "ZodObject": {
            const shape = def.shape?.() ?? {};
            const properties: Record<string, unknown> = {};
            const required: string[] = [];

            for (const [key, value] of Object.entries(shape)) {
                properties[key] = zodTypeToJson(value as z.ZodType);
                if (!isOptional(value as z.ZodType)) {
                    required.push(key);
                }
            }

            const result: Record<string, unknown> = {
                type: "object",
                properties,
            };
            if (required.length > 0) result.required = required;
            return withDescription(def, result);
        }

        default:
            return { type: "string" };
    }
}

function isOptional(schema: z.ZodType): boolean {
    const def = (schema as any)._def;
    return def?.typeName === "ZodOptional" || def?.typeName === "ZodDefault";
}

function withDescription(def: any, result: Record<string, unknown>): Record<string, unknown> {
    if (def.description) {
        result.description = def.description;
    }
    return result;
}

// ── normalizeToSize ──────────────────────────────────────────────
// 智能截断工具输出：保留首尾各 N 字符，中间用摘要替代。

export function normalizeToSize(content: string, maxChars = 30_000): string {
    if (content.length <= maxChars) return content;

    const keepEach = Math.floor(maxChars * 0.4);
    const head = content.slice(0, keepEach);
    const tail = content.slice(-keepEach);
    const omitted = content.length - keepEach * 2;

    return `${head}\n\n... [${omitted} characters omitted] ...\n\n${tail}`;
}
