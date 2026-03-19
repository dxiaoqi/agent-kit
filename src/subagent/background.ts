// ── BackgroundTaskManager ────────────────────────────────────────
// 管理后台运行的子代理任务。父 Agent 可以启动子任务后继续对话，
// 稍后通过 task_output 工具查询结果。

import type { NodeResult } from "./types.js";

export type TaskStatus = "running" | "completed" | "failed";

export interface BackgroundTask {
    id: string;
    goal: string;
    status: TaskStatus;
    result?: NodeResult;
    startedAt: number;
    completedAt?: number;
}

export class BackgroundTaskManager {
    private readonly tasks = new Map<string, BackgroundTask>();
    private nextId = 1;

    create(goal: string): BackgroundTask {
        const id = `task-${this.nextId++}`;
        const task: BackgroundTask = {
            id,
            goal,
            status: "running",
            startedAt: Date.now(),
        };
        this.tasks.set(id, task);
        return task;
    }

    complete(id: string, result: NodeResult): void {
        const task = this.tasks.get(id);
        if (!task) return;
        task.status = result.status === "completed" ? "completed" : "failed";
        task.result = result;
        task.completedAt = Date.now();
    }

    get(id: string): BackgroundTask | undefined {
        return this.tasks.get(id);
    }

    list(): BackgroundTask[] {
        return Array.from(this.tasks.values());
    }

    listByStatus(status: TaskStatus): BackgroundTask[] {
        return this.list().filter(t => t.status === status);
    }

    getSummary(): string {
        const tasks = this.list();
        if (tasks.length === 0) return "No background tasks.";

        const running = tasks.filter(t => t.status === "running").length;
        const completed = tasks.filter(t => t.status === "completed").length;
        const failed = tasks.filter(t => t.status === "failed").length;

        const lines = tasks.map(t => {
            const icon = t.status === "completed" ? "●"
                : t.status === "running" ? "◐"
                : "✕";
            const elapsed = t.completedAt
                ? `${((t.completedAt - t.startedAt) / 1000).toFixed(1)}s`
                : `${((Date.now() - t.startedAt) / 1000).toFixed(1)}s...`;
            return `  ${icon} ${t.id}: ${t.goal.slice(0, 60)} (${t.status}, ${elapsed})`;
        });

        return `Background tasks: ${running} running, ${completed} completed, ${failed} failed\n${lines.join("\n")}`;
    }

    clear(): void {
        this.tasks.clear();
    }
}
