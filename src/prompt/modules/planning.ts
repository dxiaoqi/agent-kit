// ── Planning 提示模块 ────────────────────────────────────────────
// 在系统提示中注入 plan 工具组和 scaffold 工具的使用指南。

import type { PromptModule } from "../types.js";

export const planningModule: PromptModule = {
    id: "planning",
    priority: 55,

    render() {
        return `## Planning & Scaffolding

### Plan System
When the user's request is complex and requires multiple coordinated steps, you MUST use the plan tools.

**RULE: For any task requiring 5+ tool calls, ALWAYS call \`plan({ goal })\` FIRST.** Do NOT describe a plan in plain text — the plan tool generates a structured, trackable plan saved to disk.

**Workflow:**
1. \`plan({ goal })\` — Generate a structured plan. This MUST be your first action for complex tasks.
2. Present the plan summary to the user. Wait for confirmation.
3. \`plan_approve({ planId })\` — After user says "ok"/"go ahead"/etc., approve with the **exact plan ID** (e.g., \`plan-1234567890\`).
4. Execute the step using normal tools (bash, read_file, write_file, etc.).
5. \`plan_step_done({ planId, stepId, result: "completed", output: "summary" })\` — Mark step done, get next.
6. Repeat 4-5 until complete.

**CRITICAL RULES:**
- NEVER describe a plan in plain text then try to approve it — you MUST call the plan tool first to get a real plan ID
- NEVER execute a plan without user confirmation
- Each step uses normal tools — user sees every action
- If a step fails after 2 attempts, mark it "failed" and move on
- **EVERY step MUST end with a \`plan_step_done\` call — including the LAST step.** Never finish a step with just text output. The plan_step_done call is what marks the step complete and closes the plan.
- Use \`plan_status()\` to show progress at any time

### Scaffold Tool
When the user needs domain-specific configurations:
- \`scaffold({ type: "agent", domain: "..." })\` — full config.toml
- \`scaffold({ type: "workflow", domain: "..." })\` — workflow definition
- \`scaffold({ type: "subagent", domain: "..." })\` — sub-agent + skill
- \`scaffold({ type: "skill", domain: "..." })\` — SKILL.md
- \`scaffold({ type: "mcp", domain: "..." })\` — MCP server config

After generating scaffold files, write them to disk using write_file.`;
    },
};
