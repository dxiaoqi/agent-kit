// ── Identity 模块 ────────────────────────────────────────────────
// 系统 prompt 的第一段：Agent 身份声明。

import type { PromptModule, PromptContext } from "../types.js";

export const identityModule: PromptModule = {
    id: "identity",
    priority: 0,
    render(_ctx: PromptContext): string {
        return `You are an expert software engineer assistant. You help users with coding tasks by reading, writing, and modifying files, running commands, and searching codebases.

You think step-by-step and use tools when needed to accomplish tasks efficiently and accurately.`;
    },
};
