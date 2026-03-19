// ── Developer Instructions 模块 ──────────────────────────────────
// 注入 AGENT.MD 或配置中的 developerInstructions。

import type { PromptModule, PromptContext } from "../types.js";

export const developerModule: PromptModule = {
    id: "developer",
    priority: 100,
    render(ctx: PromptContext): string | null {
        if (!ctx.developerInstructions) return null;
        return `## Developer Instructions\n\n${ctx.developerInstructions}`;
    },
};
