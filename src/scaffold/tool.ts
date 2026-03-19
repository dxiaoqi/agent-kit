// ── scaffold 工具 ────────────────────────────────────────────────
// 供 Agent 调用的 scaffold 工具：
//   scaffold({ type, domain }) → 生成特定领域的模板文件
//
// 用途：
//   1. 用户通过 /scaffold 斜杠命令触发
//   2. Agent 接收 instruction 后调用此工具生成模板
//   3. 工具通过 LLM 生成配置并返回文件列表

import { z } from "zod";
import type { ToolDef, ToolResult, ToolContext } from "../tool/types.js";
import type { LLMClient } from "../provider/client.js";
import type { ProviderProfile } from "../provider/types.js";
import { ScaffoldGenerator, type ScaffoldType } from "./generator.js";

const inputSchema = z.object({
    type: z.enum(["agent", "workflow", "subagent", "skill", "mcp"]).describe(
        "Type of scaffold to generate: agent (config.toml), workflow (workflow definition), " +
        "subagent (subagent config + skill), skill (SKILL.md), mcp (MCP server config)",
    ),
    domain: z.string().describe(
        "Domain description for the scaffold, e.g. '前端 React 开发', 'Python 数据分析', 'DevOps CI/CD'",
    ),
    context: z.string().optional().describe(
        "Additional context about the project or requirements",
    ),
});

type ScaffoldInput = z.infer<typeof inputSchema>;

interface ScaffoldToolDeps {
    llm: LLMClient;
    profile: ProviderProfile;
    cwd: string;
}

let _deps: ScaffoldToolDeps | null = null;

export function injectScaffoldDeps(deps: ScaffoldToolDeps): void {
    _deps = deps;
}

export const scaffoldTool: ToolDef<ScaffoldInput> = {
    name: "scaffold",
    description: `Generate domain-specific configuration templates for agent-kit.

Use this tool to create ready-to-use configurations for a specific domain. Types:
- agent: Complete .agent/config.toml (model profiles, permissions, sandbox)
- workflow: A workflow definition that controls agent behavior for a scenario
- subagent: Sub-agent config + SKILL.md for specialized tasks
- skill: A SKILL.md knowledge file for domain expertise
- mcp: MCP server configuration for external tool integration

The generated files should be written to disk using the appropriate file tools.`,

    inputSchema,
    isReadOnly: true,

    async execute(input: ScaffoldInput, ctx: ToolContext): Promise<ToolResult> {
        if (!_deps) {
            return { success: false, error: "Scaffold tool not initialized. Missing dependencies." };
        }

        const generator = new ScaffoldGenerator(_deps.llm, _deps.profile);

        try {
            const result = await generator.generate({
                type: input.type as ScaffoldType,
                domain: input.domain,
                cwd: ctx.cwd,
                context: input.context,
            });

            const output = [
                `## Scaffold: ${result.summary}`,
                "",
                `Generated ${result.files.length} file(s):`,
                "",
            ];

            for (const file of result.files) {
                output.push(`### ${file.path}`);
                output.push(file.description);
                output.push("");
                output.push("```");
                output.push(file.content);
                output.push("```");
                output.push("");
            }

            output.push("Please write these files to disk using write_file or edit_file tools.");

            return { success: true, output: output.join("\n") };
        } catch (err) {
            return {
                success: false,
                error: `Scaffold generation failed: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
};
