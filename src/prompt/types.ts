// ── Prompt 模块接口 ──────────────────────────────────────────────
// 每个 PromptModule 负责生成系统 prompt 的一段。
// PromptEngine 按优先级收集并拼装。

export interface PromptModule {
    id: string;
    priority: number;
    render(ctx: PromptContext): string | null;
}

export interface PromptContext {
    cwd: string;
    os: string;
    shell: string;
    date: string;
    toolNames: string[];
    developerInstructions?: string;
    extraContext?: Record<string, string>;
    skillDescriptions?: string;
    sandboxInfo?: { mode: string; available: boolean; platform: string };
}
