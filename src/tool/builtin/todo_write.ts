// ── Todo Write 工具 ──────────────────────────────────────────────
// Agent 的"外部记忆"：结构化任务管理，跨轮次持久。
// 支持创建、更新、合并模式。

import { z } from "zod";
import type { ToolDef, ToolResult, ToolContext } from "../types.js";
import { TodoStore } from "./todo_store.js";

const todoItemSchema = z.object({
    id: z.string().describe("Unique identifier for the TODO item"),
    content: z.string().describe("The description/content of the todo item"),
    status: z.enum(["pending", "in_progress", "completed", "cancelled"])
        .describe("The current status of the TODO item"),
});

const inputSchema = z.object({
    todos: z.array(todoItemSchema).min(1)
        .describe("Array of TODO items to create or update"),
    merge: z.boolean()
        .describe("If true, merge into existing todos by id. If false, replace all existing todos."),
});

type TodoWriteInput = z.infer<typeof inputSchema>;

export const todoWriteTool: ToolDef<TodoWriteInput> = {
    name: "todo_write",
    description: `Create and manage a structured task list for the current session.

Use this tool to track progress on complex multi-step tasks. Each TODO item has:
- id: unique identifier (used for merging updates)
- content: description of what needs to be done
- status: pending | in_progress | completed | cancelled

When merge=true, items are matched by id:
- Existing items with matching id are updated (only provided fields are changed)
- New ids are appended
- Items not mentioned are kept as-is

When merge=false, the provided list replaces everything.

Best practices:
- Use merge=true to update status without rewriting the whole list
- Keep only ONE item as in_progress at a time
- Mark items completed immediately after finishing them`,

    inputSchema,
    isReadOnly: false,

    async execute(input: TodoWriteInput, _ctx: ToolContext): Promise<ToolResult> {
        const store = TodoStore.instance;

        if (input.merge) {
            store.merge(input.todos);
        } else {
            store.replace(input.todos);
        }

        const summary = store.getSummary();
        return { success: true, output: summary };
    },
};
