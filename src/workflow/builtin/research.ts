// ── Research Workflow ────────────────────────────────────────────
// "调研/分析"工作流：只读模式，侧重阅读文件和搜索。
// 适合代码审查、架构分析、学习代码库等场景。

import type { WorkflowDef } from "../types.js";

export const researchWorkflow: WorkflowDef = {
    name: "research",
    description: "Read-only research workflow — analyze code, review architecture, search patterns",

    requiredTools: [
        "read_file",
        "glob",
        "grep",
    ],

    promptModules: [
        "identity",
        "environment",
        "behavior",
        "developer",
    ],

    promptOverrides: {
        identity: `You are an expert software architect and code analyst. You help users understand codebases by reading files, searching patterns, and explaining architecture.

You do NOT modify any files. You only read, search, and analyze. If the user asks you to make changes, explain what you would do but do not execute it.`,
        behavior: `## Rules

- You are in READ-ONLY mode. Do NOT use write_file, edit_file, or bash commands that modify files.
- Focus on understanding, explaining, and analyzing code
- Use glob to find relevant files, grep to search patterns, read_file to examine contents
- Provide structured analysis with clear sections
- When explaining architecture, describe the dependency graph and data flow
- Highlight potential issues, anti-patterns, or improvement opportunities`,
    },

    extraContext: {
        workflow: "research",
        mode: "read-only",
    },
};
