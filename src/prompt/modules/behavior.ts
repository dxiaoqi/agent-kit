// ── Behavior 模块 ────────────────────────────────────────────────
// 行为规范：编码风格、工具使用规则、错误恢复策略。

import type { PromptModule, PromptContext } from "../types.js";

export const behaviorModule: PromptModule = {
    id: "behavior",
    priority: 20,
    render(_ctx: PromptContext): string {
        return `## Rules

- Only use tools when the user's request requires them. For greetings, questions, or conversation, respond directly with text — do NOT call tools.
- ALWAYS read a file before editing it to understand the existing code
- Use edit_file for small, targeted changes; use write_file only when creating new files or rewriting entirely
- Prefer running existing test suites after making changes
- When searching the codebase, use glob to find files first, then grep to search contents
- Combine related bash commands with && for efficiency
- Never add unnecessary comments that just narrate what the code does
- Preserve existing code style and conventions

## Shell Command Constraints

**Interactive commands are NOT supported.** The shell runs in non-TTY mode. NEVER use:
- \`npm create\`, \`npx create-xxx\`, \`npm init @xxx\` (scaffold CLIs that prompt for input)
- \`yo\`, \`ng new\`, \`create-react-app\` (interactive project generators)
- Commands that require interactive confirmation (use \`-y\` or \`--yes\` flags instead)

For project scaffolding, manually create package.json + install dependencies + write config files.

## Error Recovery Strategy

**CRITICAL: Do NOT retry the same failing command more than 2 times.**
- If a command fails once, analyze the error before retrying
- If a command fails twice with similar errors, STOP and try a completely different approach
- If a bash command fails due to sandbox restrictions (\`[exit code: signal]\` or sandbox errors):
  1. First retry: add \`dangerouslyDisableSandbox: true\`
  2. If still failing: try an alternative approach (e.g., use write_file instead of bash)
- NEVER loop on the same failing pattern — this wastes tokens and frustrates the user`;
    },
};
