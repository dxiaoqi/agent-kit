// ── Todo Read 工具 ───────────────────────────────────────────────
// 读取当前 TODO 列表。Agent 可以在新轮次开始时回顾任务进度。

import { z } from "zod";
import type { ToolDef, ToolResult, ToolContext } from "../types.js";
import { TodoStore } from "./todo_store.js";

const inputSchema = z.object({
    status: z.enum(["pending", "in_progress", "completed", "cancelled", "all"])
        .optional()
        .describe("Filter by status. Use 'all' to see everything. Defaults to 'all'."),
});

type TodoReadInput = z.infer<typeof inputSchema>;

export const todoReadTool: ToolDef<TodoReadInput> = {
    name: "todo_read",
    description: `Read the current TODO list.

Returns the structured task list with id, status, and content for each item.
Use the status parameter to filter (e.g., only "pending" or "in_progress").

This is useful to:
- Review progress at the start of a new turn
- Check which tasks remain before finishing`,

    inputSchema,
    isReadOnly: true,

    async execute(input: TodoReadInput, _ctx: ToolContext): Promise<ToolResult> {
        const store = TodoStore.instance;
        const status = input.status ?? "all";
        const items = status === "all"
            ? store.getAll()
            : store.getByStatus(status);

        if (items.length === 0) {
            return { success: true, output: "No TODO items found." };
        }

        const lines = items.map(item => {
            const icon = STATUS_ICONS[item.status];
            return `${icon} [${item.id}] ${item.content} (${item.status})`;
        });

        const header = status === "all"
            ? `TODO List — ${items.length} item(s):`
            : `TODO List — ${items.length} item(s) with status "${status}":`;


        return { success: true, output: `${header}\n${lines.join("\n")}` };
    },
};

const STATUS_ICONS: Record<string, string> = {
    pending: "○",
    in_progress: "◐",
    completed: "●",
    cancelled: "✕",
};
