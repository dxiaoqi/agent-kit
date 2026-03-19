// ── SubagentRunner：单子代理执行器 ────────────────────────────────
// 为一个 DAGNode 创建隔离的 Agent 实例并运行。
// 子代理拥有独立的 ContextManager（通过 fork），可限制工具子集。
// 通过 ModelRegistry 解析完整的模型 profile（含 apiKey、baseUrl、provider）。

import { Agent, type AgentConfig } from "../kernel/agent.js";
import type { LLMClient } from "../provider/client.js";
import { ToolRegistry } from "../tool/registry.js";
import type { AgentEvent } from "../kernel/events.js";
import type { DAGNode, DAGNodeConfig, NodeResult, BusMessage } from "./types.js";
import type { ProviderProfile } from "../provider/types.js";
import type { ModelRegistry } from "../provider/registry.js";

export interface RunnerDeps {
    llm: LLMClient;
    parentTools: ToolRegistry;
    baseProfile: ProviderProfile;
    cwd: string;
    /** ModelRegistry 用于按名称解析完整 profile（含不同的 apiKey/baseUrl） */
    registry?: ModelRegistry;
}

export class SubagentRunner {
    constructor(
        private readonly node: DAGNode,
        private readonly deps: RunnerDeps,
    ) {}

    async run(upstreamMessages: BusMessage[]): Promise<NodeResult> {
        const startTime = Date.now();
        const config = { ...this.node.config } as DAGNodeConfig;

        const scopedTools = this.buildToolRegistry(config);
        const systemPrompt = this.buildSystemPrompt(upstreamMessages);
        const profile = this.resolveProfile(config);

        const agentConfig: AgentConfig = {
            systemPrompt,
            profile,
            maxTurns: config.maxTurns ?? 20,
            transcriptDir: null,
        };

        const agent = new Agent(agentConfig, this.deps.llm, scopedTools);

        try {
            let output = "";
            const tokenUsage = { prompt: 0, completion: 0, total: 0 };

            for await (const event of agent.run(this.node.goal)) {
                this.processEvent(event, (text) => { output += text; }, tokenUsage);
            }

            agent.close();

            return {
                nodeId: this.node.id,
                status: "completed",
                output: output.trim(),
                durationMs: Date.now() - startTime,
                tokenUsage,
            };
        } catch (err) {
            agent.close();
            return {
                nodeId: this.node.id,
                status: "failed",
                error: err instanceof Error ? err.message : String(err),
                durationMs: Date.now() - startTime,
            };
        }
    }

    /**
     * 解析子代理的模型 profile。优先级：
     * 1. DAGNodeConfig.model 指定的 profile ID → 从 ModelRegistry 查询完整 profile
     * 2. ModelRegistry 的 "subagent" 角色绑定
     * 3. 继承父 Agent 的 baseProfile
     */
    private resolveProfile(config: DAGNodeConfig): ProviderProfile {
        const registry = this.deps.registry;

        if (config.model && registry) {
            try {
                return registry.get(config.model);
            } catch {
                // profile not found, fall through
            }
        }

        if (registry) {
            try {
                return registry.getForRole("subagent");
            } catch {
                // no subagent binding, fall through
            }
        }

        return this.deps.baseProfile;
    }

    private buildToolRegistry(config: DAGNodeConfig): ToolRegistry {
        const scoped = new ToolRegistry();
        const allowed = config.allowedTools;
        const readOnly = config.readOnly ?? false;

        for (const name of this.deps.parentTools.list()) {
            if (allowed && !allowed.includes(name)) continue;

            const tool = this.deps.parentTools.get(name);
            if (!tool) continue;

            if (readOnly && !tool.isReadOnly) continue;

            scoped.register(tool);
        }

        return scoped;
    }

    private buildSystemPrompt(upstreamMessages: BusMessage[]): string {
        const parts: string[] = [
            `You are a sub-agent with a specific task. Complete it efficiently and report your results.`,
            `\n## Your Task\n\n${this.node.goal}`,
        ];

        if (upstreamMessages.length > 0) {
            parts.push("\n## Context from upstream agents\n");
            for (const msg of upstreamMessages) {
                parts.push(`### From: ${msg.from}\n\n${msg.payload}`);
            }
        }

        return parts.join("\n");
    }

    private processEvent(
        event: AgentEvent,
        appendText: (text: string) => void,
        tokenUsage: { prompt: number; completion: number; total: number },
    ): void {
        switch (event.type) {
            case "text_delta":
                appendText(event.text);
                break;
            case "agent_end":
                if (event.usage) {
                    tokenUsage.prompt += event.usage.promptTokens;
                    tokenUsage.completion += event.usage.completionTokens;
                    tokenUsage.total += event.usage.totalTokens;
                }
                break;
        }
    }
}
