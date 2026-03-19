// ── PromptEngine ─────────────────────────────────────────────────
// 收集所有注册的 PromptModule，按优先级排序后拼装系统 prompt。
// 支持 Workflow 驱动的动态模块激活和内容覆盖。

import type { PromptModule, PromptContext } from "./types.js";

export class PromptEngine {
    private readonly modules: PromptModule[] = [];

    /** Workflow 激活的模块 id 过滤器（null = 全部激活） */
    private activeFilter: Set<string> | null = null;

    /** Workflow 注入的内容覆盖（module id → 替换文本） */
    private overrides = new Map<string, string>();

    // ── 注册 ────────────────────────────────────────────────────

    register(module: PromptModule): void {
        this.modules.push(module);
        this.modules.sort((a, b) => a.priority - b.priority);
    }

    // ── 构建 System Prompt ──────────────────────────────────────

    build(ctx: PromptContext): string {
        const parts: string[] = [];

        for (const mod of this.modules) {
            if (this.activeFilter && !this.activeFilter.has(mod.id)) {
                continue;
            }

            const override = this.overrides.get(mod.id);
            if (override !== undefined) {
                parts.push(override);
                continue;
            }

            const result = mod.render(ctx);
            if (result) parts.push(result);
        }

        return parts.join("\n\n");
    }

    // ── Workflow 动态控制 ────────────────────────────────────────

    setActiveModules(moduleIds: string[]): void {
        this.activeFilter = new Set(moduleIds);
    }

    clearActiveFilter(): void {
        this.activeFilter = null;
    }

    applyOverrides(overrides: Record<string, string>): void {
        for (const [id, text] of Object.entries(overrides)) {
            this.overrides.set(id, text);
        }
    }

    clearOverrides(): void {
        this.overrides.clear();
    }

    // ── 查询 ────────────────────────────────────────────────────

    getModuleIds(): string[] {
        return this.modules.map(m => m.id);
    }

    getActiveModuleIds(): string[] {
        if (!this.activeFilter) return this.getModuleIds();
        return this.modules
            .filter(m => this.activeFilter!.has(m.id))
            .map(m => m.id);
    }

    hasModule(id: string): boolean {
        return this.modules.some(m => m.id === id);
    }
}
