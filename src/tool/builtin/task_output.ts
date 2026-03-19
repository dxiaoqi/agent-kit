// ── Task Output 工具 ─────────────────────────────────────────────
// 查询后台子代理任务的执行状态和结果。

import { z } from "zod";
import type { ToolDef, ToolResult, ToolContext } from "../types.js";
import type { BackgroundTaskManager } from "../../subagent/background.js";

const inputSchema = z.object({
    taskId: z.string().optional()
        .describe("Specific task ID to query. Omit to list all tasks."),
});

type TaskOutputInput = z.infer<typeof inputSchema>;

let _taskManager: BackgroundTaskManager | null = null;

export function injectTaskOutputDeps(manager: BackgroundTaskManager): void {
    _taskManager = manager;
}

export const taskOutputTool: ToolDef<TaskOutputInput> = {
    name: "task_output",
    description: `Check the status and output of background sub-agent tasks.

Without taskId: returns a summary of all tasks.
With taskId: returns the detailed result of a specific task.

Task statuses:
- running: task is still executing
- completed: task finished successfully (output available)
- failed: task encountered an error (error message available)`,

    inputSchema,
    isReadOnly: true,

    async execute(input: TaskOutputInput, _ctx: ToolContext): Promise<ToolResult> {
        if (!_taskManager) {
            return { success: false, error: "Task system not initialized" };
        }

        if (!input.taskId) {
            return {
                success: true,
                output: _taskManager.getSummary(),
            };
        }

        const task = _taskManager.get(input.taskId);
        if (!task) {
            return {
                success: false,
                error: `Task not found: ${input.taskId}`,
            };
        }

        const lines: string[] = [
            `Task: ${task.id}`,
            `Goal: ${task.goal}`,
            `Status: ${task.status}`,
            `Started: ${new Date(task.startedAt).toISOString()}`,
        ];

        if (task.completedAt) {
            lines.push(`Completed: ${new Date(task.completedAt).toISOString()}`);
            lines.push(`Duration: ${((task.completedAt - task.startedAt) / 1000).toFixed(1)}s`);
        }

        if (task.result) {
            if (task.result.output) {
                lines.push(`\n--- Output ---\n${task.result.output}`);
            }
            if (task.result.error) {
                lines.push(`\n--- Error ---\n${task.result.error}`);
            }
            if (task.result.tokenUsage) {
                const u = task.result.tokenUsage;
                lines.push(`\nTokens: ${u.prompt} prompt + ${u.completion} completion = ${u.total} total`);
            }
        }

        return {
            success: true,
            output: lines.join("\n"),
        };
    },
};
