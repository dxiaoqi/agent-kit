// ── Task 工具 ────────────────────────────────────────────────────
// 父 Agent 通过此工具启动子代理任务（前台或后台）。
// 子代理作为独立 DAG 节点执行，拥有隔离的 context。
// 支持通过 model 参数指定子代理使用的模型 profile。

import { z } from "zod";
import type { ToolDef, ToolResult, ToolContext } from "../types.js";
import { BackgroundTaskManager } from "../../subagent/background.js";
import { SubagentRunner, type RunnerDeps } from "../../subagent/runner.js";
import type { DAGNode } from "../../subagent/types.js";

const inputSchema = z.object({
    description: z.string().describe("Short 3-5 word description of the task"),
    prompt: z.string().describe("Detailed instructions for the sub-agent"),
    model: z.string().optional()
        .describe("Model profile ID to use for this sub-agent (e.g. 'claude', 'default'). Omit to use the 'subagent' role binding."),
    allowedTools: z.array(z.string()).optional()
        .describe("Tool whitelist for the sub-agent. Omit to inherit all parent tools."),
    readOnly: z.boolean().optional()
        .describe("If true, sub-agent can only use read-only tools"),
    maxTurns: z.number().optional()
        .describe("Max conversation turns for the sub-agent (default 20)"),
    background: z.boolean().optional()
        .describe("If true, run in background and return immediately with a task ID"),
});

type TaskInput = z.infer<typeof inputSchema>;

let _runnerDeps: RunnerDeps | null = null;
let _taskManager: BackgroundTaskManager | null = null;

export function injectTaskDeps(deps: RunnerDeps, manager: BackgroundTaskManager): void {
    _runnerDeps = deps;
    _taskManager = manager;
}

export const taskTool: ToolDef<TaskInput> = {
    name: "task",
    description: `Launch a sub-agent to handle a complex, multi-step task autonomously.

The sub-agent runs in an isolated context with its own conversation history.
It can use tools from the parent agent (optionally restricted).

Use this when:
- A task is complex and benefits from focused, independent execution
- You want to parallelize work (use background: true)
- You need to isolate a task's context to avoid polluting the main conversation

Options:
- model: specify which model profile to use (must be defined in config.toml)
- allowedTools: restrict which tools the sub-agent can access
- readOnly: true to only allow read-only tools

The sub-agent will return its final output as the tool result.
For background tasks, use task_output to check results later.`,

    inputSchema,
    isReadOnly: false,

    async execute(input: TaskInput, ctx: ToolContext): Promise<ToolResult> {
        if (!_runnerDeps || !_taskManager) {
            return { success: false, error: "Task system not initialized" };
        }

        const node: DAGNode = {
            id: `inline-${Date.now()}`,
            type: "inline",
            goal: input.prompt,
            config: {
                model: input.model,
                allowedTools: input.allowedTools,
                readOnly: input.readOnly,
                maxTurns: input.maxTurns ?? 20,
            },
        };

        const runner = new SubagentRunner(node, { ..._runnerDeps, cwd: ctx.cwd });

        if (input.background) {
            const task = _taskManager.create(input.description);

            runner.run([]).then(result => {
                _taskManager!.complete(task.id, result);
            }).catch(err => {
                _taskManager!.complete(task.id, {
                    nodeId: node.id,
                    status: "failed",
                    error: err instanceof Error ? err.message : String(err),
                });
            });

            return {
                success: true,
                output: `Background task started: ${task.id}\nGoal: ${input.description}\nUse task_output to check results.`,
            };
        }

        const result = await runner.run([]);

        if (result.status === "completed") {
            return {
                success: true,
                output: result.output ?? "(no output)",
            };
        }

        return {
            success: false,
            error: result.error ?? "Sub-agent failed with unknown error",
        };
    },
};
