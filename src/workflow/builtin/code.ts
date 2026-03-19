// ── Code Workflow ────────────────────────────────────────────────
// 内置"代码开发"工作流，复刻 Claude Code 的行为模式。
// 激活时使用完整的代码开发 Prompt 模块集和所有代码工具。

import type { WorkflowDef } from "../types.js";

export const codeWorkflow: WorkflowDef = {
    name: "code",
    description: "Software engineering workflow — read, write, edit code, run commands, manage tasks",

    requiredTools: [
        "bash",
        "read_file",
        "write_file",
        "edit_file",
        "glob",
        "grep",
    ],

    promptModules: [
        "identity",
        "environment",
        "behavior",
        "developer",
    ],

    extraContext: {
        workflow: "code",
    },
};
