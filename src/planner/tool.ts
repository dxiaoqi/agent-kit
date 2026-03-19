// ── Plan 工具组 ──────────────────────────────────────────────────
// 拆分为 4 个工具，配合主 Agent 循环实现可观察的逐步执行：
//
//   plan           → 生成计划 + 保存到 .agent/plans/ + 返回预览供用户审查
//   plan_approve   → 用户审查后批准执行（或 Agent 按用户指示调用）
//   plan_status    → 查看计划当前状态
//   plan_step_done → 标记当前步骤完成，获取下一步指令
//
// 关键设计：
//   plan 不自行执行任何步骤。生成后由 Agent 展示给用户。
//   用户确认后，Agent 循环调用 plan_step_done 推进计划。
//   每一步都由 Agent 在主循环中用常规工具执行 → 权限审批 + UI 可见。

import { z } from "zod";
import type { ToolDef, ToolResult, ToolContext } from "../tool/types.js";
import type { LLMClient } from "../provider/client.js";
import type { ProviderProfile } from "../provider/types.js";
import type { WorkflowManager } from "../workflow/manager.js";
import type { ToolRegistry } from "../tool/registry.js";
import { Planner } from "./planner.js";
import { PlanStore } from "./store.js";

// ── 依赖注入 ────────────────────────────────────────────────────

interface PlanToolDeps {
    llm: LLMClient;
    profile: ProviderProfile;
    toolRegistry: ToolRegistry;
    workflowManager?: WorkflowManager;
    subagentNames: string[];
}

let _deps: PlanToolDeps | null = null;
let _store: PlanStore | null = null;
let _activePlanId: string | null = null;

export function injectPlanDeps(deps: PlanToolDeps): void {
    _deps = deps;
}

export function injectPlanStore(store: PlanStore): void {
    _store = store;
}

function getStore(ctx: ToolContext): PlanStore {
    if (!_store) {
        _store = new PlanStore(ctx.cwd);
    }
    return _store;
}

// ── 1. plan — 生成计划 ──────────────────────────────────────────

const planInputSchema = z.object({
    goal: z.string().describe(
        "The high-level goal to plan. Should be a complex task that requires multiple steps.",
    ),
    context: z.string().optional().describe(
        "Additional context to help the planner (project structure, constraints, etc.)",
    ),
});

export const planTool: ToolDef<z.infer<typeof planInputSchema>> = {
    name: "plan",
    description: `Generate a structured execution plan for a complex goal.

This tool ONLY generates the plan and saves it to .agent/plans/ for user review.
It does NOT execute anything. After generating:
1. Present the plan to the user
2. Ask if they want to proceed, modify, or cancel
3. If approved, call plan_approve to start execution
4. Then execute each step using normal tools, calling plan_step_done after each step

Use this when the user's request requires multiple coordinated steps.`,

    inputSchema: planInputSchema,
    isReadOnly: true,

    async execute(input, ctx): Promise<ToolResult> {
        if (!_deps) {
            return { success: false, error: "Plan tool not initialized." };
        }

        const store = getStore(ctx);
        const { llm, profile, toolRegistry, workflowManager, subagentNames } = _deps;

        const planner = new Planner(llm, profile);

        let plan;
        try {
            plan = await planner.generate({
                goal: input.goal,
                cwd: ctx.cwd,
                availableTools: toolRegistry.list(),
                availableWorkflows: workflowManager?.list() ?? [],
                availableSubagents: subagentNames,
                extraContext: input.context,
            });
        } catch (err) {
            return {
                success: false,
                error: `Failed to generate plan: ${err instanceof Error ? err.message : String(err)}`,
            };
        }

        const state = store.save(plan);

        return {
            success: true,
            output: [
                PlanStore.formatPlan(state),
                "",
                "---",
                "The plan has been saved to `.agent/plans/" + plan.id + ".json`.",
                "Present this plan to the user and ask if they want to:",
                "- **Execute** it → call `plan_approve({ planId: \"" + plan.id + "\" })`",
                "- **Modify** → the user can edit the JSON file directly, then approve",
                "- **Cancel** → do nothing",
                "",
                "IMPORTANT: Do NOT proceed without user confirmation.",
            ].join("\n"),
        };
    },
};

// ── 2. plan_approve — 批准执行 ──────────────────────────────────

const approveInputSchema = z.object({
    planId: z.string().describe("The plan ID to approve and start executing"),
});

export const planApproveTool: ToolDef<z.infer<typeof approveInputSchema>> = {
    name: "plan_approve",
    description: `Approve a previously generated plan and get the first step to execute.
Call this after the user has reviewed and approved the plan.
Returns the first step's instruction for you to execute using normal tools.`,

    inputSchema: approveInputSchema,
    isReadOnly: true,

    async execute(input, ctx): Promise<ToolResult> {
        const store = getStore(ctx);
        const state = store.load(input.planId);

        if (!state) {
            return { success: false, error: `Plan not found: ${input.planId}` };
        }

        if (state.status !== "pending_review") {
            return { success: false, error: `Plan is already ${state.status}, cannot approve.` };
        }

        store.update(input.planId, s => {
            s.status = "running";
        });

        _activePlanId = input.planId;

        const nextStep = store.getNextPendingStep(input.planId);
        if (!nextStep) {
            return { success: false, error: "No executable steps found in plan." };
        }

        // Mark this step as running
        store.update(input.planId, s => {
            s.stepStates[nextStep.id] = {
                ...s.stepStates[nextStep.id],
                status: "running",
                startedAt: Date.now(),
            };
        });

        return {
            success: true,
            output: formatStepInstruction(state, nextStep),
        };
    },
};

// ── 3. plan_step_done — 标记步骤完成，获取下一步 ──────────────

const stepDoneInputSchema = z.object({
    planId: z.string().describe("The plan ID"),
    stepId: z.string().describe("The step ID that was just completed"),
    result: z.enum(["completed", "failed", "skipped"]).describe("Step result"),
    output: z.string().optional().describe("Brief summary of what was accomplished (or error)"),
});

export const planStepDoneTool: ToolDef<z.infer<typeof stepDoneInputSchema>> = {
    name: "plan_step_done",
    description: `Mark a plan step as done and get the next step to execute.

Call this after completing each step in a plan. The tool will:
1. Update the step status in the plan file
2. Return the next step's instruction, or indicate the plan is complete

If the step failed, downstream dependent steps will be automatically skipped.`,

    inputSchema: stepDoneInputSchema,
    isReadOnly: true,

    async execute(input, ctx): Promise<ToolResult> {
        const store = getStore(ctx);
        const state = store.load(input.planId);

        if (!state) {
            return { success: false, error: `Plan not found: ${input.planId}` };
        }

        // Update the completed step
        store.update(input.planId, s => {
            s.stepStates[input.stepId] = {
                ...s.stepStates[input.stepId],
                status: input.result as any,
                output: input.output?.slice(0, 2000),
                completedAt: Date.now(),
            };

            // If failed, skip downstream
            if (input.result === "failed") {
                skipDownstream(input.stepId, s);
            }
        });

        // Check if plan is done
        const updated = store.load(input.planId)!;
        if (store.isPlanDone(input.planId)) {
            const anyFailed = Object.values(updated.stepStates).some(s => s.status === "failed");
            store.update(input.planId, s => {
                s.status = anyFailed ? "failed" : "completed";
            });

            const finalState = store.load(input.planId)!;
            _activePlanId = null;

            const summary = [
                `## Plan ${anyFailed ? "Failed" : "Completed"}`,
                "",
                PlanStore.formatPlan(finalState),
            ].join("\n");

            if (anyFailed) {
                return { success: false, error: summary };
            }
            return { success: true, output: summary };
        }

        // Get all ready steps
        const readySteps = store.getReadySteps(input.planId);
        if (readySteps.length === 0) {
            store.update(input.planId, s => { s.status = "failed"; });
            _activePlanId = null;
            return {
                success: false,
                error: "No more executable steps. Remaining steps are blocked by failed dependencies.",
            };
        }

        // Mark the first ready step as running
        const nextStep = readySteps[0];
        store.update(input.planId, s => {
            s.stepStates[nextStep.id] = {
                ...s.stepStates[nextStep.id],
                status: "running",
                startedAt: Date.now(),
            };
        });

        const latest = store.load(input.planId)!;
        const output = formatStepInstruction(latest, nextStep);

        // Notify about parallel-ready steps
        if (readySteps.length > 1) {
            const parallelHint = readySteps.slice(1).map(s => `  - ${s.id}: ${s.title}`).join("\n");
            return {
                success: true,
                output: output + `\n\n**Note:** ${readySteps.length - 1} additional step(s) are ready and could run in parallel via \`task\` tool:\n${parallelHint}`,
            };
        }

        return { success: true, output };
    },
};

// ── 4. plan_status — 查看计划状态 ───────────────────────────────

const statusInputSchema = z.object({
    planId: z.string().optional().describe("Specific plan ID. If omitted, shows the active plan or lists all plans."),
});

export const planStatusTool: ToolDef<z.infer<typeof statusInputSchema>> = {
    name: "plan_status",
    description: `View the current status of a plan or list all plans.
Use without planId to see the active plan or list all plans.
Use with planId to see details of a specific plan.`,

    inputSchema: statusInputSchema,
    isReadOnly: true,

    async execute(input, ctx): Promise<ToolResult> {
        const store = getStore(ctx);

        const targetId = input.planId ?? _activePlanId;

        if (targetId) {
            const state = store.load(targetId);
            if (!state) {
                return { success: false, error: `Plan not found: ${targetId}` };
            }
            return {
                success: true,
                output: PlanStore.formatPlan(state),
            };
        }

        // List all plans
        const plans = store.list();
        if (plans.length === 0) {
            return { success: true, output: "No plans found. Use `plan({ goal })` to create one." };
        }

        const lines = [
            "## Plans",
            "",
            ...plans.map(p => {
                const date = new Date(p.createdAt).toLocaleString();
                return `- **${p.id}** [${p.status}] ${p.goal.slice(0, 80)} (${p.steps} steps, ${date})`;
            }),
        ];

        return { success: true, output: lines.join("\n") };
    },
};

// ── Helpers ──────────────────────────────────────────────────────

function formatStepInstruction(state: import("./store.js").PersistentPlanState, step: import("./types.js").PlanStep): string {
    const totalSteps = state.plan.steps.length;
    const completedCount = Object.values(state.stepStates).filter(s => s.status === "completed").length;
    const isFirstStep = completedCount === 0;

    const lines: string[] = [
        `## Step ${completedCount + 1}/${totalSteps}: ${step.title}`,
        `**ID:** ${step.id}  |  **Strategy:** ${step.strategy}  |  **Plan:** ${state.plan.id}`,
        "",
    ];

    // Only include plan context on first step to save tokens
    if (isFirstStep && state.plan.context) {
        lines.push(`### Plan Context`, state.plan.context, "");
    }

    // Only include direct upstream output (not full history)
    if (step.dependsOn.length > 0) {
        const upstreamSummaries = step.dependsOn
            .map(dep => {
                const depStep = state.plan.steps.find(s => s.id === dep);
                const depState = state.stepStates[dep];
                if (depStep && depState?.output) {
                    return `- ${depStep.title}: ${depState.output.slice(0, 300)}`;
                }
                return null;
            })
            .filter(Boolean);
        if (upstreamSummaries.length > 0) {
            lines.push(`### Depends on`, upstreamSummaries.join("\n"), "");
        }
    }

    lines.push(step.instruction);

    if (step.acceptance) {
        lines.push("", `**Done when:** ${step.acceptance}`);
    }

    lines.push(
        "",
        `**MANDATORY:** When this step is done, you MUST call plan_step_done({ planId: "${state.plan.id}", stepId: "${step.id}", result: "completed", output: "summary" }). Do NOT end your turn without this call.`,
    );

    return lines.join("\n");
}

function skipDownstream(failedId: string, state: import("./store.js").PersistentPlanState): void {
    for (const step of state.plan.steps) {
        if (step.dependsOn.includes(failedId)) {
            if (state.stepStates[step.id]?.status === "pending") {
                state.stepStates[step.id].status = "skipped";
                skipDownstream(step.id, state);
            }
        }
    }
}
