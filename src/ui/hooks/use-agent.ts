// ── useAgent Hook ────────────────────────────────────────────────
// 管理 Agent 生命周期：消息历史、loading 状态、事件消费。
// 关键设计：使用 ref 做中间缓冲，避免在 state setter 内嵌套更新。

import { useState, useCallback, useRef } from "react";
import type { Agent } from "../../kernel/agent.js";
import type { AgentEvent } from "../../kernel/events.js";
import type { TokenUsage } from "../../provider/types.js";

export interface UIMessage {
    id: string;
    type: "user" | "assistant_text" | "tool_use" | "tool_result" | "tool_error" | "system" | "permission_request";
    content: string;
    toolName?: string;
    toolArgs?: Record<string, unknown>;
    toolResult?: { success: boolean; output?: string; error?: string };
    status?: "pending" | "success" | "error";
    completed: boolean;
    permissionRequestId?: string;
    riskLevel?: "low" | "moderate" | "high";
}

export interface UseAgentReturn {
    items: UIMessage[];
    isLoading: boolean;
    hasStreamedThisTurn: boolean;
    tokenUsage?: TokenUsage;
    turnCount: number;
    submit: (input: string) => void;
    addSystemMsg: (text: string) => void;
    /** 当前是否有待审批的权限请求 */
    pendingPermission: UIMessage | null;
    /** 审批回调 */
    resolvePermission: (approved: boolean, persist?: "session" | "config" | null) => void;
}

let msgIdCounter = 0;

export function useAgent(agent: Agent): UseAgentReturn {
    const [items, setItems] = useState<UIMessage[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [hasStreamedThisTurn, setHasStreamedThisTurn] = useState(false);
    const [tokenUsage, setTokenUsage] = useState<TokenUsage | undefined>();
    const [turnCount, setTurnCount] = useState(0);
    const [pendingPermission, setPendingPermission] = useState<UIMessage | null>(null);
    const streamingMsgId = useRef<string | null>(null);

    const appendItem = useCallback((item: UIMessage) => {
        setItems(prev => [...prev, item]);
    }, []);

    const updateItem = useCallback((id: string, updater: (item: UIMessage) => UIMessage) => {
        setItems(prev => prev.map(item => (item.id === id ? updater(item) : item)));
    }, []);

    const runStream = useCallback(async (input: string, streamFactory: () => AsyncGenerator<AgentEvent>) => {
        const userMsg: UIMessage = {
            id: `msg-${msgIdCounter++}`,
            type: "user",
            content: input,
            completed: true,
        };
        appendItem(userMsg);
        setIsLoading(true);
        setHasStreamedThisTurn(false);
        streamingMsgId.current = null;

        try {
            for await (const event of streamFactory()) {
                switch (event.type) {
                    case "text_delta": {
                        setHasStreamedThisTurn(true);
                        if (!streamingMsgId.current) {
                            const id = `msg-${msgIdCounter++}`;
                            streamingMsgId.current = id;
                            appendItem({
                                id,
                                type: "assistant_text",
                                content: event.text,
                                completed: false,
                            });
                            break;
                        }

                        updateItem(streamingMsgId.current, item => ({
                            ...item,
                            content: item.content + event.text,
                        }));
                        break;
                    }

                    case "text_complete":
                        setHasStreamedThisTurn(true);
                        if (streamingMsgId.current) {
                            updateItem(streamingMsgId.current, item => ({
                                ...item,
                                content: event.text,
                                completed: true,
                            }));
                            streamingMsgId.current = null;
                        } else {
                            appendItem({
                                id: `msg-${msgIdCounter++}`,
                                type: "assistant_text",
                                content: event.text,
                                completed: true,
                            });
                        }
                        break;

                    case "tool_call_start":
                        appendItem({
                            id: `tool-${event.callId}`,
                            type: "tool_use",
                            content: event.name,
                            toolName: event.name,
                            toolArgs: event.args,
                            status: "pending",
                            completed: false,
                        });
                        break;

                    case "tool_call_complete": {
                        updateItem(`tool-${event.callId}`, item => ({
                            ...item,
                            toolResult: event.result as any,
                            status: event.result.success ? "success" : "error",
                            completed: true,
                        }));
                        break;
                    }

                    case "tool_call_error": {
                        updateItem(`tool-${event.callId}`, item => ({
                            ...item,
                            toolResult: { success: false, error: event.error },
                            status: "error",
                            completed: true,
                        }));
                        break;
                    }

                    case "permission_request": {
                        const permMsg: UIMessage = {
                            id: `perm-${event.id}`,
                            type: "permission_request",
                            content: `Permission required: ${event.toolName}`,
                            toolName: event.toolName,
                            toolArgs: event.args,
                            permissionRequestId: event.id,
                            riskLevel: event.riskLevel,
                            completed: false,
                        };
                        appendItem(permMsg);
                        setPendingPermission(permMsg);
                        break;
                    }

                    case "context_compact": {
                        appendItem({
                            id: `msg-${msgIdCounter++}`,
                            type: "system",
                            content: `Context compacted: ${event.tokensBefore} → ${event.tokensAfter} tokens`,
                            completed: true,
                        });
                        break;
                    }

                    case "plan_created": {
                        appendItem({
                            id: `msg-${msgIdCounter++}`,
                            type: "system",
                            content: `📋 Plan created: ${event.goal} (${event.stepCount} steps)\n   → ${event.filePath}`,
                            completed: true,
                        });
                        break;
                    }

                    case "plan_step_start": {
                        appendItem({
                            id: `plan-step-${event.planId}-${event.stepId}`,
                            type: "system",
                            content: `▶ Plan step ${event.stepIndex}/${event.totalSteps}: ${event.stepTitle}`,
                            completed: false,
                        });
                        break;
                    }

                    case "plan_step_complete": {
                        const icon = event.result === "completed" ? "✓" : event.result === "failed" ? "✗" : "⊘";
                        const dur = event.durationMs ? ` [${(event.durationMs / 1000).toFixed(1)}s]` : "";
                        updateItem(`plan-step-${event.planId}-${event.stepId}`, item => ({
                            ...item,
                            content: `${icon} Plan step: ${event.stepTitle} — ${event.result}${dur}`,
                            completed: true,
                        }));
                        break;
                    }

                    case "plan_complete": {
                        const emoji = event.success ? "✓" : "✗";
                        appendItem({
                            id: `msg-${msgIdCounter++}`,
                            type: "system",
                            content: `${emoji} Plan ${event.success ? "completed" : "failed"}: ${event.completedSteps}/${event.totalSteps} steps completed${event.failedSteps > 0 ? `, ${event.failedSteps} failed` : ""}`,
                            completed: true,
                        });
                        break;
                    }

                    case "agent_end":
                        if (event.usage) setTokenUsage(event.usage);
                        setTurnCount(event.turnCount);
                        break;

                    case "agent_error": {
                        appendItem({
                            id: `msg-${msgIdCounter++}`,
                            type: "system",
                            content: event.error,
                            completed: true,
                        });
                        break;
                    }
                }
            }
        } catch (err: any) {
            appendItem({
                id: `msg-${msgIdCounter++}`,
                type: "system",
                content: `Error: ${err.message}`,
                completed: true,
            });
        } finally {
            streamingMsgId.current = null;
            setIsLoading(false);
        }
    }, [appendItem, updateItem]);

    const submit = useCallback(async (input: string) => {
        await runStream(input, () => agent.run(input));
    }, [agent, runStream]);

    const addSystemMsg = useCallback((text: string) => {
        setItems(prev => [...prev, {
            id: `msg-${msgIdCounter++}`,
            type: "system" as const,
            content: text,
            completed: true,
        }]);
    }, []);

    const resolvePermission = useCallback((approved: boolean, persist: "session" | "config" | null = null) => {
        agent.resolvePermission({
            action: approved ? "allow" : "deny",
            persist,
        });

        if (pendingPermission) {
            updateItem(pendingPermission.id, item => ({
                ...item,
                content: approved ? `✓ Approved: ${item.toolName}` : `✗ Denied: ${item.toolName}`,
                completed: true,
            }));
            setPendingPermission(null);
        }
    }, [agent, pendingPermission, updateItem]);

    return {
        items, isLoading, hasStreamedThisTurn, tokenUsage, turnCount,
        submit, addSystemMsg, pendingPermission, resolvePermission,
    };
}
