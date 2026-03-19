// ── WorkflowManager ──────────────────────────────────────────────
// 管理工作流的注册、激活、切换。
// 激活工作流时：
//   1. 停用当前工作流
//   2. 校验所需工具
//   3. 设置 PromptEngine 活跃模块 + 覆盖
//   4. 调用 onActivate 钩子

import type { WorkflowDef, WorkflowContext } from "./types.js";
import type { PromptEngine } from "../prompt/engine.js";
import type { ToolRegistry } from "../tool/registry.js";

export class WorkflowManager {
    private readonly workflows = new Map<string, WorkflowDef>();
    private active: WorkflowDef | null = null;

    constructor(
        private readonly promptEngine: PromptEngine,
        private readonly toolRegistry: ToolRegistry,
        private readonly contextFactory: () => WorkflowContext,
    ) {}

    // ── 注册 ────────────────────────────────────────────────────

    register(workflow: WorkflowDef): void {
        this.workflows.set(workflow.name, workflow);
    }

    // ── 激活 ────────────────────────────────────────────────────

    async activate(name: string): Promise<void> {
        const workflow = this.workflows.get(name);
        if (!workflow) {
            throw new Error(`Unknown workflow: ${name}. Available: ${this.list().join(", ")}`);
        }

        // 1. 停用当前
        if (this.active) {
            await this.active.onDeactivate?.();
        }

        // 2. 校验所需工具
        const missing = workflow.requiredTools.filter(t => !this.toolRegistry.has(t));
        if (missing.length > 0) {
            throw new Error(
                `Workflow "${name}" requires missing tools: ${missing.join(", ")}`,
            );
        }

        // 3. 设置 PromptEngine
        this.promptEngine.setActiveModules(workflow.promptModules);
        if (workflow.promptOverrides) {
            this.promptEngine.applyOverrides(workflow.promptOverrides);
        }

        // 4. 钩子
        const ctx = this.contextFactory();
        await workflow.onActivate?.(ctx);

        this.active = workflow;
    }

    // ── 停用 ────────────────────────────────────────────────────

    async deactivate(): Promise<void> {
        if (this.active) {
            await this.active.onDeactivate?.();
            this.promptEngine.clearActiveFilter();
            this.promptEngine.clearOverrides();
            this.active = null;
        }
    }

    // ── 查询 ────────────────────────────────────────────────────

    getActive(): WorkflowDef | null {
        return this.active;
    }

    getActiveName(): string | null {
        return this.active?.name ?? null;
    }

    get(name: string): WorkflowDef | undefined {
        return this.workflows.get(name);
    }

    list(): string[] {
        return Array.from(this.workflows.keys());
    }

    getInfo(): WorkflowInfo[] {
        return Array.from(this.workflows.values()).map(w => ({
            name: w.name,
            description: w.description,
            active: w === this.active,
            requiredTools: w.requiredTools,
            promptModules: w.promptModules,
        }));
    }
}

export interface WorkflowInfo {
    name: string;
    description: string;
    active: boolean;
    requiredTools: string[];
    promptModules: string[];
}
