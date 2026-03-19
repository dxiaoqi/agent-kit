// ── load_skill 工具 ──────────────────────────────────────────────
// Layer 2：Agent 按需加载 skill 的完整指令。
// 返回内容注入到 tool_result，不污染 system prompt。

import { z } from "zod";
import type { ToolDef, ToolResult, ToolContext } from "../tool/types.js";
import type { SkillLoader } from "./loader.js";

let _loader: SkillLoader | null = null;

export function injectSkillLoader(loader: SkillLoader): void {
    _loader = loader;
}

const inputSchema = z.object({
    name: z.string().describe("The skill name to load (as listed in the system prompt)"),
});

type LoadSkillInput = z.infer<typeof inputSchema>;

export const loadSkillTool: ToolDef<LoadSkillInput> = {
    name: "load_skill",
    description: `Load a skill to get detailed instructions for a specific capability.

Skills provide specialized knowledge and step-by-step instructions.
The system prompt lists available skills by name and description.
Use this tool when you need the full instructions for a skill.

The loaded skill content will be returned as this tool's result,
giving you the detailed instructions to follow.`,

    inputSchema,
    isReadOnly: true,

    async execute(input: LoadSkillInput, _ctx: ToolContext): Promise<ToolResult> {
        if (!_loader) {
            return { success: false, error: "Skill system not initialized" };
        }

        if (!_loader.has(input.name)) {
            const available = _loader.list();
            return {
                success: false,
                error: `Skill "${input.name}" not found. Available: ${available.join(", ") || "(none)"}`,
            };
        }

        const content = _loader.getContent(input.name);
        if (!content) {
            return { success: false, error: `Skill "${input.name}" has no content` };
        }

        return {
            success: true,
            output: `<skill name="${input.name}">\n${content}\n</skill>`,
        };
    },
};
