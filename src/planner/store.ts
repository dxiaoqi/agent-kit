// ── PlanStore：计划持久化 ─────────────────────────────────────────
// 将计划存储到 .agent/plans/<id>.json，支持读写、列表、状态更新。
// 用户可在文件系统中直接查看/编辑计划文件。

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { PlanDef, PlanStep, StepStatus } from "./types.js";

export interface PersistentPlanState {
    plan: PlanDef;
    status: "pending_review" | "approved" | "running" | "paused" | "completed" | "failed";
    currentStepIndex: number;
    stepStates: Record<string, PersistentStepState>;
    createdAt: number;
    updatedAt: number;
}

export interface PersistentStepState {
    status: StepStatus;
    output?: string;
    error?: string;
    startedAt?: number;
    completedAt?: number;
}

export class PlanStore {
    private readonly dir: string;

    constructor(cwd: string) {
        this.dir = join(cwd, ".agent", "plans");
        mkdirSync(this.dir, { recursive: true });
    }

    save(plan: PlanDef): PersistentPlanState {
        const state: PersistentPlanState = {
            plan,
            status: "pending_review",
            currentStepIndex: 0,
            stepStates: {},
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        for (const step of plan.steps) {
            state.stepStates[step.id] = { status: "pending" };
        }

        this.write(plan.id, state);
        return state;
    }

    load(planId: string): PersistentPlanState | null {
        const filePath = join(this.dir, `${planId}.json`);
        if (!existsSync(filePath)) return null;
        try {
            return JSON.parse(readFileSync(filePath, "utf-8"));
        } catch {
            return null;
        }
    }

    update(planId: string, updater: (state: PersistentPlanState) => void): PersistentPlanState | null {
        const state = this.load(planId);
        if (!state) return null;
        updater(state);
        state.updatedAt = Date.now();
        this.write(planId, state);
        return state;
    }

    list(): Array<{ id: string; goal: string; status: string; steps: number; createdAt: number }> {
        if (!existsSync(this.dir)) return [];
        const files = readdirSync(this.dir).filter(f => f.endsWith(".json"));
        const result: Array<{ id: string; goal: string; status: string; steps: number; createdAt: number }> = [];

        for (const file of files) {
            try {
                const state = JSON.parse(readFileSync(join(this.dir, file), "utf-8")) as PersistentPlanState;
                result.push({
                    id: state.plan.id,
                    goal: state.plan.goal,
                    status: state.status,
                    steps: state.plan.steps.length,
                    createdAt: state.createdAt,
                });
            } catch {
                // skip corrupt files
            }
        }

        return result.sort((a, b) => b.createdAt - a.createdAt);
    }

    getNextPendingStep(planId: string): PlanStep | null {
        const ready = this.getReadySteps(planId);
        return ready.length > 0 ? ready[0] : null;
    }

    /** Returns ALL steps whose dependencies are satisfied and status is pending */
    getReadySteps(planId: string): PlanStep[] {
        const state = this.load(planId);
        if (!state) return [];

        const ready: PlanStep[] = [];
        for (const step of state.plan.steps) {
            const ss = state.stepStates[step.id];
            if (ss.status !== "pending") continue;

            const depsOk = step.dependsOn.every(dep => {
                const depState = state.stepStates[dep];
                return depState?.status === "completed";
            });

            if (depsOk) ready.push(step);
        }
        return ready;
    }

    isPlanDone(planId: string): boolean {
        const state = this.load(planId);
        if (!state) return true;
        return Object.values(state.stepStates).every(
            s => s.status === "completed" || s.status === "skipped" || s.status === "failed",
        );
    }

    private write(planId: string, state: PersistentPlanState): void {
        writeFileSync(join(this.dir, `${planId}.json`), JSON.stringify(state, null, 2), "utf-8");
    }

    // ── 格式化 ──────────────────────────────────────────────────

    static formatPlan(state: PersistentPlanState): string {
        const icon: Record<string, string> = {
            pending: "○",
            running: "◉",
            completed: "✓",
            failed: "✗",
            skipped: "⊘",
        };

        const statusIcon: Record<string, string> = {
            pending_review: "📋 Pending Review",
            approved: "✅ Approved",
            running: "▶ Running",
            paused: "⏸ Paused",
            completed: "✓ Completed",
            failed: "✗ Failed",
        };

        const lines: string[] = [
            `## Plan: ${state.plan.summary}`,
            `**ID:** ${state.plan.id}`,
            `**Goal:** ${state.plan.goal}`,
            `**Status:** ${statusIcon[state.status] || state.status}`,
            `**Steps:** ${state.plan.steps.length}`,
            "",
        ];

        for (let i = 0; i < state.plan.steps.length; i++) {
            const step = state.plan.steps[i];
            const ss = state.stepStates[step.id];
            const ic = icon[ss?.status || "pending"] || "?";
            const deps = step.dependsOn.length > 0
                ? ` (after: ${step.dependsOn.join(", ")})`
                : "";
            const duration = ss?.startedAt && ss?.completedAt
                ? ` [${((ss.completedAt - ss.startedAt) / 1000).toFixed(1)}s]`
                : "";

            lines.push(`${ic} **Step ${i + 1}** (${step.id}): ${step.title} [${step.strategy}]${deps}${duration}`);
            lines.push(`  ${step.instruction.slice(0, 200)}${step.instruction.length > 200 ? "..." : ""}`);

            if (ss?.error) {
                lines.push(`  └─ Error: ${ss.error.slice(0, 150)}`);
            }
            if (step.acceptance) {
                lines.push(`  └─ Acceptance: ${step.acceptance}`);
            }
            lines.push("");
        }

        lines.push(`*Plan file: .agent/plans/${state.plan.id}.json*`);

        return lines.join("\n");
    }
}
