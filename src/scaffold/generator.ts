// ── Scaffold 模板生成器 ──────────────────────────────────────────
// 通过 LLM 交互式地为用户生成特定领域的配置模板：
//
// 支持的模板类型：
//   agent    → .agent/config.toml 的完整配置（模型、权限、沙箱）
//   workflow → src/workflow/builtin/<name>.ts 工作流定义
//   subagent → config.toml [[subagents]] + SKILL.md
//   skill    → .agent/skills/<name>/SKILL.md
//   mcp      → .agent/mcp.json 中的服务器配置
//
// 工作流程：
//   /scaffold <type> <domain>
//   → LLM 生成适合该领域的模板
//   → 写入对应文件

import type { LLMClient } from "../provider/client.js";
import type { ProviderProfile } from "../provider/types.js";

export type ScaffoldType = "agent" | "workflow" | "subagent" | "skill" | "mcp";

export interface ScaffoldRequest {
    type: ScaffoldType;
    /** 领域描述（如 "前端 React 开发", "数据分析 Python", "DevOps CI/CD"） */
    domain: string;
    /** 当前项目目录 */
    cwd: string;
    /** 额外上下文 */
    context?: string;
}

export interface ScaffoldResult {
    files: ScaffoldFile[];
    summary: string;
}

export interface ScaffoldFile {
    path: string;
    content: string;
    description: string;
}

export class ScaffoldGenerator {
    constructor(
        private readonly llm: LLMClient,
        private readonly profile: ProviderProfile,
    ) {}

    async generate(request: ScaffoldRequest): Promise<ScaffoldResult> {
        const systemPrompt = this.buildSystemPrompt(request);
        const userPrompt = `Generate a ${request.type} configuration for: ${request.domain}${
            request.context ? `\n\nAdditional context: ${request.context}` : ""
        }`;

        const messages = [
            { role: "system" as const, content: systemPrompt },
            { role: "user" as const, content: userPrompt },
        ];

        let fullText = "";
        for await (const event of this.llm.chat(messages, [], this.profile)) {
            if (event.type === "text_delta") {
                fullText += event.text;
            }
        }

        return this.parseResult(fullText);
    }

    private buildSystemPrompt(request: ScaffoldRequest): string {
        const prompts: Record<ScaffoldType, string> = {
            agent: this.agentPrompt(),
            workflow: this.workflowPrompt(),
            subagent: this.subagentPrompt(),
            skill: this.skillPrompt(),
            mcp: this.mcpPrompt(),
        };

        return `You are a configuration template generator for agent-kit, an AI agent CLI tool.

${prompts[request.type]}

## Output Format

You MUST output a valid JSON object:

\`\`\`json
{
  "summary": "One-line description of what was generated",
  "files": [
    {
      "path": "relative/path/to/file",
      "content": "full file content as a string",
      "description": "what this file does"
    }
  ]
}
\`\`\`

## Guidelines

- Generate practical, production-ready configurations
- Include helpful comments in the generated files
- Use sensible defaults with commented alternatives
- Tailor tool selections, permissions, and prompts to the specific domain
- Write SKILL.md content in the same language as the user's domain description

Output ONLY the JSON. No markdown fences wrapping the JSON.`;
    }

    private agentPrompt(): string {
        return `Generate a complete .agent/config.toml for a specific domain.

The config should include:
- Model profiles tailored to the domain (e.g., Claude for coding, GPT-4o for general)
- Model bindings (main, compaction, subagent)
- Appropriate approval policy
- Permission rules for common operations in this domain
- Safety rules for domain-specific dangerous commands
- Sandbox configuration
- Workflow suggestion
- Predefined subagents for the domain`;
    }

    private workflowPrompt(): string {
        return `Generate a TypeScript workflow definition file for agent-kit.

A workflow controls which tools are available and how the agent's prompt is configured.

Example structure:
\`\`\`typescript
import type { WorkflowDef } from "../../workflow/types.js";

export const myWorkflow: WorkflowDef = {
    name: "my-workflow",
    description: "Description",
    requiredTools: ["bash", "read_file", "edit_file", ...],
    promptModules: ["identity", "environment", "behavior"],
    promptOverrides: {
        identity: "You are a specialized ... agent.",
    },
    extraContext: {
        "domain-rules": "Specific rules for this domain...",
    },
};
\`\`\`

Generate a workflow that:
- Selects the right tool subset for the domain
- Overrides the identity prompt to be domain-specific
- Adds domain-specific rules as extra context`;
    }

    private subagentPrompt(): string {
        return `Generate TWO files for a domain-specific sub-agent:

1. A TOML snippet for config.toml (the [[subagents]] section)
2. A SKILL.md file for the sub-agent's specialized knowledge

The subagent config format:
\`\`\`toml
[[subagents]]
name         = "agent-name"
description  = "What this agent does"
goalPrompt   = "You are a specialized agent for..."
model        = "default"
allowedTools = ["tool1", "tool2"]
maxTurns     = 30
\`\`\`

The SKILL.md format:
\`\`\`markdown
---
name: skill-name
description: One line description
tags: tag1,tag2
---

# Skill Title

Detailed instructions...
\`\`\`

Generate a subagent that:
- Has a focused tool set for the domain
- Includes a SKILL.md with domain expertise
- Has appropriate maxTurns for task complexity`;
    }

    private skillPrompt(): string {
        return `Generate a SKILL.md file for agent-kit.

SKILL.md format:
\`\`\`markdown
---
name: skill-name
description: One-line description
tags: tag1,tag2
---

# Skill Title

Detailed, structured instructions that guide the agent in this domain.
Include:
- Checklists
- Best practices
- Common pitfalls to avoid
- Output format guidelines
\`\`\`

The file path should be: .agent/skills/<name>/SKILL.md

Generate a comprehensive skill that:
- Covers the domain thoroughly
- Uses structured sections (##, ###)
- Includes actionable checklists
- Specifies expected output format`;
    }

    private mcpPrompt(): string {
        return `Generate a .agent/mcp.json configuration for MCP (Model Context Protocol) servers relevant to the domain.

MCP config format:
\`\`\`json
{
  "mcpServers": {
    "server-name": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-xxx"],
      "env": { "TOKEN": "your-token-here" }
    }
  }
}
\`\`\`

Available MCP server types:
- stdio: local process (command + args + env)
- http: remote server (url + headers)

Suggest MCP servers that would be useful for the domain. Use real, existing @modelcontextprotocol/* packages where possible, and mark hypothetical ones with comments.`;
    }

    private parseResult(raw: string): ScaffoldResult {
        let jsonStr = raw.trim();
        const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
        if (fenceMatch) jsonStr = fenceMatch[1].trim();

        let parsed: any;
        try {
            parsed = JSON.parse(jsonStr);
        } catch {
            const objMatch = jsonStr.match(/\{[\s\S]*\}/);
            if (objMatch) {
                parsed = JSON.parse(objMatch[0]);
            } else {
                throw new Error("Failed to parse scaffold result from LLM");
            }
        }

        return {
            summary: parsed.summary || "Generated scaffold files",
            files: (parsed.files || []).map((f: any) => ({
                path: f.path,
                content: f.content,
                description: f.description || "",
            })),
        };
    }
}
