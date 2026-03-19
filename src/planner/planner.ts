// ── Planner：计划生成引擎 ─────────────────────────────────────────
// 调用 LLM 将高层意图转化为结构化执行计划。
//
// 流程：
//   1. 收集环境上下文（工具、工作流、子代理、目录结构）
//   2. 构建 planning prompt（JSON Schema 约束输出格式）
//   3. 调用 LLM 生成 PlanDef
//   4. 校验和修正生成的计划

import type { LLMClient } from "../provider/client.js";
import type { ProviderProfile } from "../provider/types.js";
import type { PlanDef, PlanStep, PlanRequest } from "./types.js";

export class Planner {
    constructor(
        private readonly llm: LLMClient,
        private readonly profile: ProviderProfile,
    ) {}

    async generate(request: PlanRequest): Promise<PlanDef> {
        const systemPrompt = this.buildSystemPrompt(request);
        const userPrompt = this.buildUserPrompt(request);

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

        return this.parsePlan(fullText, request.goal);
    }

    private buildSystemPrompt(request: PlanRequest): string {
        return `You are a planning engine. Your job is to analyze the user's goal and produce a structured execution plan.

## Available Capabilities

### Tools
${request.availableTools.map(t => `- ${t}`).join("\n")}

### Workflows
${request.availableWorkflows.length > 0 ? request.availableWorkflows.map(w => `- ${w}`).join("\n") : "- (none)"}

### Sub-agent Types
${request.availableSubagents.length > 0 ? request.availableSubagents.map(s => `- ${s}`).join("\n") : "- (none)"}

### Working Directory
${request.cwd}

## Output Format

You MUST output a valid JSON object matching this schema:

\`\`\`json
{
  "summary": "One-line plan summary",
  "steps": [
    {
      "id": "step-1",
      "title": "Human-readable step title",
      "instruction": "Detailed instruction for the agent to execute this step",
      "strategy": "agent | subagent | parallel | workflow",
      "dependsOn": [],
      "acceptance": "How to verify this step is done",
      "config": {
        "model": "optional model profile id",
        "allowedTools": ["optional", "tool", "subset"],
        "maxTurns": 20,
        "readOnly": false
      }
    }
  ],
  "context": "Optional shared context for all steps"
}
\`\`\`

## Strategy Guidelines

- **agent**: Use for simple, sequential operations that the main agent can handle directly (e.g., read a file, run a command, edit a file). This is the default.
- **subagent**: Use for independent, complex subtasks that benefit from isolated context (e.g., "implement authentication module", "write comprehensive tests").
- **parallel**: Use when multiple independent subtasks can run simultaneously. The instruction should clearly list each subtask.
- **workflow**: Use when the step requires switching to a specific mode (e.g., "research" for read-only analysis).

## Planning Principles

1. **Right granularity**: Each step should represent a logical unit of work, NOT a single command. For example, "Initialize project and install dependencies" is ONE step (npm init + npm install can be combined). "Create all model files" is ONE step if they are related.
2. Identify dependencies correctly (what must finish before what)
3. Maximize parallelism where possible — independent branches (e.g., frontend and backend) should NOT depend on each other
4. Use subagents for isolated, complex work
5. Start with analysis/research steps before implementation
6. Include verification steps (run tests, check types)
7. Each step's instruction must be self-contained and actionable
8. Keep step count reasonable: **5-10 steps for most tasks**. Avoid splitting trivially related operations (like "install deps" and "install more deps") into separate steps.
9. **Combine npm install commands** — ALL dependencies for a module should be installed in a single step
10. **Combine file creation** — Multiple related files (e.g., model + controller + route for one feature) can be ONE step

## Environment Constraints

- Shell runs in **non-TTY mode**: interactive commands (npm create, npx create-xxx, yo, ng new) will FAIL
- For project scaffolding: manually create package.json, install deps, and write config files
- Prefer \`mkdir -p\` with full paths over separate mkdir commands

Output ONLY the JSON object. No markdown fences, no explanation.`;
    }

    private buildUserPrompt(request: PlanRequest): string {
        let prompt = `Create an execution plan for the following goal:\n\n${request.goal}`;

        if (request.extraContext) {
            prompt += `\n\n## Additional Context\n\n${request.extraContext}`;
        }

        return prompt;
    }

    private parsePlan(raw: string, goal: string): PlanDef {
        // Extract JSON from potentially wrapped response
        let jsonStr = raw.trim();

        const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
        if (fenceMatch) {
            jsonStr = fenceMatch[1].trim();
        }

        let parsed: any;
        try {
            parsed = JSON.parse(jsonStr);
        } catch {
            // Attempt to find JSON object in the text
            const objMatch = jsonStr.match(/\{[\s\S]*\}/);
            if (objMatch) {
                parsed = JSON.parse(objMatch[0]);
            } else {
                throw new Error("Failed to parse plan JSON from LLM response");
            }
        }

        const steps: PlanStep[] = (parsed.steps || []).map((s: any, i: number) => ({
            id: s.id || `step-${i + 1}`,
            title: s.title || `Step ${i + 1}`,
            instruction: s.instruction || s.description || "",
            strategy: this.validateStrategy(s.strategy),
            dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn : [],
            acceptance: s.acceptance,
            config: s.config ? {
                model: s.config.model,
                allowedTools: s.config.allowedTools,
                maxTurns: s.config.maxTurns,
                readOnly: s.config.readOnly,
            } : undefined,
        }));

        this.validateDependencies(steps);

        return {
            id: `plan-${Date.now()}`,
            goal,
            summary: parsed.summary || goal,
            steps,
            context: parsed.context,
        };
    }

    private validateStrategy(s: string): PlanStep["strategy"] {
        const valid = ["agent", "subagent", "parallel", "workflow"];
        return valid.includes(s) ? s as PlanStep["strategy"] : "agent";
    }

    private validateDependencies(steps: PlanStep[]): void {
        const ids = new Set(steps.map(s => s.id));
        for (const step of steps) {
            step.dependsOn = step.dependsOn.filter(dep => ids.has(dep));
        }
    }
}
