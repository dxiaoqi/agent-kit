// ── Agent 核心循环 ───────────────────────────────────────────────
// 基于 Plugin / Tool / Provider / Message 抽象的 Agent Loop。
// 使用 AsyncGenerator 驱动，对外发射 AgentEvent 流。
// 通过 ContextManager 管理消息存储与上下文压缩。

import type { ToolCall, TokenUsage, ProviderProfile, ToolSchema } from "../provider/types.js";
import { addTokenUsage, createTokenUsage } from "../provider/types.js";
import type { LLMClient } from "../provider/client.js";
import type { CostTracker } from "../provider/cost.js";
import type { ToolRegistry } from "../tool/registry.js";
import type { ContentBlock } from "../context/message.js";
import { ContextManager, type ContextManagerConfig, type CompactResult } from "../context/manager.js";
import { LLMSummarizer } from "../context/summarizer.js";
import { AgentEvents, type AgentEvent } from "./events.js";
import { classifyError } from "./errors.js";
import { PermissionEngine } from "../permission/engine.js";
import type { PermissionMode, ApprovalResponse } from "../permission/types.js";
import type { WorkflowManager } from "../workflow/manager.js";

// ── Agent 配置 ───────────────────────────────────────────────────

export interface AgentConfig {
    systemPrompt: string;
    profile: ProviderProfile;
    maxTurns: number;
    maxRetries?: number;
    /** 会话日志目录，设为 null 禁用日志 */
    transcriptDir?: string | null;
    /** 权限引擎（不传则全部放行） */
    permissionEngine?: PermissionEngine;
    /** 工作流管理器 */
    workflowManager?: WorkflowManager;
}

// ── Agent 类 ─────────────────────────────────────────────────────

export class Agent {
    private readonly ctx: ContextManager;
    private readonly config: AgentConfig;
    private readonly llm: LLMClient;
    private readonly tools: ToolRegistry;
    private readonly summarizer: LLMSummarizer;
    private readonly permissions: PermissionEngine | null;
    private turnCount = 0;
    private totalUsage: TokenUsage = createTokenUsage();
    private abortController: AbortController | null = null;

    // 用于异步等待用户审批
    private pendingApproval: {
        resolve: (response: ApprovalResponse) => void;
    } | null = null;

    constructor(
        config: AgentConfig,
        llm: LLMClient,
        tools: ToolRegistry,
    ) {
        this.config = config;
        this.llm = llm;
        this.tools = tools;
        this.permissions = config.permissionEngine ?? null;

        this.ctx = new ContextManager({
            systemPrompt: config.systemPrompt,
            contextWindow: config.profile.contextWindow,
            transcriptDir: config.transcriptDir ?? ".agent/transcripts",
        });

        this.summarizer = new LLMSummarizer(llm, config.profile);
    }

    // ── 用户发送消息，驱动一轮或多轮 Agent Loop ────────────────

    async *run(input: string): AsyncGenerator<AgentEvent> {
        this.ctx.addUserMessage(input);
        this.abortController = new AbortController();

        yield AgentEvents.start(this.config.profile.name);

        let shouldContinue = true;

        const unlimited = !this.config.maxTurns || this.config.maxTurns <= 0;

        while (shouldContinue && (unlimited || this.turnCount < this.config.maxTurns)) {
            this.turnCount++;

            // 压缩检查：auto_compact 在 micro_compact 后仍超阈值时触发
            yield* this.checkAndCompact();

            const turnResult = yield* this.executeTurn();

            shouldContinue = turnResult.hasToolCalls;
        }

        if (!unlimited && this.turnCount >= this.config.maxTurns) {
            yield AgentEvents.error(
                `Reached maximum turns (${this.config.maxTurns})`,
                false,
            );
        }

        yield AgentEvents.end(this.turnCount, this.totalUsage, this.llm.costs.cost);
    }

    // ── 压缩检查 ─────────────────────────────────────────────────

    private async *checkAndCompact(): AsyncGenerator<AgentEvent> {
        if (this.ctx.needsAutoCompact) {
            const result = await this.ctx.runAutoCompact(this.summarizer);
            if (result) {
                yield AgentEvents.contextCompact(
                    result.summary,
                    result.tokensBefore,
                    result.tokensAfter,
                );
            }
        }
    }

    // ── 单轮执行：调用 LLM → 解析响应 → 执行工具 ──────────────

    private async *executeTurn(): AsyncGenerator<AgentEvent, { hasToolCalls: boolean }> {
        const oaiMessages = this.ctx.prepareForLLMCall();
        const toolSchemas = this.tools.getSchemas();
        const schemas = toolSchemas.length > 0 ? toolSchemas : null;

        let text = "";
        const toolCalls: ToolCall[] = [];
        let turnUsage: TokenUsage | undefined;

        try {
            for await (const event of this.llm.chat(
                oaiMessages,
                schemas,
                this.config.profile,
                this.abortController?.signal,
            )) {
                switch (event.type) {
                    case "text_delta":
                        text += event.text;
                        yield AgentEvents.textDelta(event.text);
                        break;

                    case "tool_call_complete":
                        toolCalls.push(event.toolCall);
                        break;

                    case "message_complete":
                        if (event.usage) {
                            turnUsage = event.usage;
                            this.totalUsage = addTokenUsage(this.totalUsage, event.usage);
                        }
                        if (event.toolCalls) {
                            for (const tc of event.toolCalls) {
                                if (!toolCalls.find(t => t.callId === tc.callId)) {
                                    toolCalls.push(tc);
                                }
                            }
                        }
                        break;

                    case "error": {
                        const classified = classifyError(new Error(event.error));
                        if (classified.isContextOverflow) {
                            // 上下文溢出 → 强制压缩后重试
                            const compactResult = await this.ctx.forceCompact(this.summarizer);
                            yield AgentEvents.contextCompact(
                                compactResult.summary,
                                compactResult.tokensBefore,
                                compactResult.tokensAfter,
                            );
                            yield AgentEvents.error(
                                "Context overflow — compacted and retrying",
                                true,
                            );
                            return { hasToolCalls: false };
                        }
                        yield AgentEvents.error(event.error, event.retryable);
                        return { hasToolCalls: false };
                    }
                }
            }
        } catch (err) {
            const classified = classifyError(err);
            if (classified.isContextOverflow) {
                const compactResult = await this.ctx.forceCompact(this.summarizer);
                yield AgentEvents.contextCompact(
                    compactResult.summary,
                    compactResult.tokensBefore,
                    compactResult.tokensAfter,
                );
                yield AgentEvents.error("Context overflow — compacted and retrying", true);
                return { hasToolCalls: false };
            }
            yield AgentEvents.error(classified.message, classified.isRetryable);
            return { hasToolCalls: false };
        }

        // 完成文本
        if (text) {
            yield AgentEvents.textComplete(text);
        }

        // 构建 assistant 消息
        const toolUseBlocks: ContentBlock.ToolUse[] = toolCalls.map(tc => ({
            type: "tool_use",
            id: tc.callId,
            name: tc.name,
            input: tc.args,
        }));
        this.ctx.addAssistantMessage(
            text,
            toolUseBlocks.length > 0 ? toolUseBlocks : undefined,
        );

        if (toolCalls.length === 0) {
            return { hasToolCalls: false };
        }

        // 执行工具（含权限检查）
        for (const call of toolCalls) {
            yield AgentEvents.toolCallStart(call);

            // ── 权限检查 ────────────────────────────────────
            const permResult: "allow" | "deny" = yield* this.checkPermission(call);
            if (permResult === "deny") {
                const denyMsg = `Permission denied for tool "${call.name}". The user rejected this operation.`;
                yield AgentEvents.toolCallError(call.callId, call.name, denyMsg);
                this.ctx.addToolResult(call.callId, denyMsg, true);
                continue;
            }

            const result = await this.tools.execute(
                call.name,
                call.args,
                { cwd: process.cwd() },
            );

            this.trackFileAccess(call.name, call.args);

            if (result.success) {
                yield AgentEvents.toolCallComplete(call.callId, call.name, result);
                this.ctx.addToolResult(call.callId, result.output);
            } else {
                yield AgentEvents.toolCallError(call.callId, call.name, result.error);
                this.ctx.addToolResult(call.callId, result.error, true);
            }
        }

        return { hasToolCalls: true };
    }

    // ── 权限检查 ───────────────────────────────────────────────────

    private async *checkPermission(
        call: ToolCall,
    ): AsyncGenerator<AgentEvent, "allow" | "deny"> {
        if (!this.permissions) return "allow";

        const toolDef = this.tools.get(call.name);
        const isReadOnly = toolDef?.isReadOnly ?? false;

        const query = PermissionEngine.buildQuery(
            call.name,
            call.args,
            isReadOnly,
            process.cwd(),
        );

        const checkResult = this.permissions.check(query);

        if (checkResult.decision === "allow") return "allow";
        if (checkResult.decision === "deny") return "deny";

        // decision === "ask" → 发射事件并异步等待 UI 审批
        const requestId = `perm-${Date.now()}-${call.callId}`;
        yield AgentEvents.permissionRequest(
            requestId,
            call.name,
            call.args,
            checkResult.riskLevel,
        );

        const response = await new Promise<ApprovalResponse>((resolve) => {
            this.pendingApproval = { resolve };
        });

        this.pendingApproval = null;
        this.permissions.handleApproval(query, response);

        return response.action;
    }

    /**
     * UI 层在用户做出审批决定后调用此方法。
     * 解锁被挂起的权限检查。
     */
    resolvePermission(response: ApprovalResponse): void {
        if (this.pendingApproval) {
            this.pendingApproval.resolve(response);
        }
    }

    // ── 文件热度追踪 ─────────────────────────────────────────────

    private trackFileAccess(toolName: string, args: Record<string, unknown>): void {
        const filePath = (args.path ?? args.file_path ?? args.file) as string | undefined;
        if (!filePath) return;

        const writeTools = new Set(["write_file", "edit_file"]);
        const readTools = new Set(["read_file", "glob", "grep"]);

        if (writeTools.has(toolName)) {
            this.ctx.trackFileWrite(filePath);
        } else if (readTools.has(toolName)) {
            this.ctx.trackFileRead(filePath);
        }
    }

    // ── 公共方法 ─────────────────────────────────────────────────

    /**
     * 手动触发压缩（/compact 命令）
     */
    async *compact(): AsyncGenerator<AgentEvent> {
        const result = await this.ctx.forceCompact(this.summarizer);
        yield AgentEvents.contextCompact(
            result.summary,
            result.tokensBefore,
            result.tokensAfter,
        );
    }

    abort(): void {
        this.abortController?.abort();
    }

    // ── 状态查询 ────────────────────────────────────────────────

    getMessages(): readonly import("../context/message.js").Message[] {
        return this.ctx.getMessages();
    }

    getTurnCount(): number {
        return this.turnCount;
    }

    getTotalUsage(): TokenUsage {
        return this.totalUsage;
    }

    getContextStats(): {
        tokens: number;
        utilization: number;
        messages: number;
        compacts: number;
        trackedFiles: number;
        indexedCompacts: number;
        lastRecall: { recovered: boolean; tokensUsed: number; matchCount: number };
    } {
        const recall = this.ctx.recall;
        return {
            tokens: this.ctx.tokenCount,
            utilization: this.ctx.utilizationPercent,
            messages: this.ctx.messageCount,
            compacts: this.ctx.compacts,
            trackedFiles: this.ctx.fileFreshness.size,
            indexedCompacts: this.ctx.indexedCompacts,
            lastRecall: {
                recovered: recall.recovered,
                tokensUsed: recall.tokensUsed,
                matchCount: recall.matchCount,
            },
        };
    }

    // ── 成本追踪 ────────────────────────────────────────────────────

    get costs(): CostTracker {
        return this.llm.costs;
    }

    // ── 权限模式管理 ──────────────────────────────────────────────

    getPermissionMode(): PermissionMode {
        return this.permissions?.getMode() ?? "bypassPermissions";
    }

    setPermissionMode(mode: PermissionMode): void {
        this.permissions?.setMode(mode);
    }

    cyclePermissionMode(): PermissionMode {
        return this.permissions?.cycleMode() ?? "bypassPermissions";
    }

    // ── 工作流管理 ────────────────────────────────────────────────

    get workflows(): WorkflowManager | null {
        return this.config.workflowManager ?? null;
    }

    close(): void {
        this.ctx.close();
    }
}
