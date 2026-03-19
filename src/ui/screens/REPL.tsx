// ── REPL 主屏幕 ──────────────────────────────────────────────────
// 布局：
//   <Static>   — 已完成的消息，永久写入终端，不可覆盖
//   <Box>      — Transient 区域，每帧清除重绘（spinner / 流式文本 / 输入框）
// 关键：<Static> 和 <Box> 都是 Fragment 的直接子元素。

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Newline, Static, Text, useInput, useApp } from "ink";
import type { Agent } from "../../kernel/agent.js";
import { useTheme } from "../hooks/use-registry.js";
import { useAgent, type UIMessage } from "../hooks/use-agent.js";
import { Spinner } from "../components/Spinner.js";
import { PromptInput } from "../components/PromptInput.js";
import { StatusBar } from "../components/StatusBar.js";
import { AssistantText } from "../messages/AssistantText.js";
import { ToolUse } from "../messages/ToolUse.js";
import { SystemNotice } from "../messages/SystemNotice.js";
import { PermissionDialog } from "../permissions/PermissionDialog.js";

interface REPLProps {
    agent: Agent;
    modelId: string;
}

export function REPL({ agent, modelId }: REPLProps) {
    const { exit } = useApp();
    const {
        items, isLoading, hasStreamedThisTurn, tokenUsage, turnCount,
        submit, addSystemMsg, pendingPermission, resolvePermission,
    } = useAgent(agent);
    const [selectedToolIdx, setSelectedToolIdx] = useState(0);
    const [expandedToolIds, setExpandedToolIds] = useState<Set<string>>(new Set());
    const isStreaming = items.some(item => item.type === "assistant_text" && !item.completed);
    const collapsibleToolIds = useMemo(
        () => items.filter(item => item.type === "tool_use" && item.toolResult).map(item => item.id),
        [items],
    );
    const staticPrefixLength = useMemo(
        () => items.findIndex(item => !item.completed || item.type === "tool_use"),
        [items],
    );
    const splitIndex = staticPrefixLength === -1 ? items.length : staticPrefixLength;
    const staticItems = items.slice(0, splitIndex);
    const transientItems = items.slice(splitIndex);

    useEffect(() => {
        if (collapsibleToolIds.length === 0) {
            setSelectedToolIdx(0);
            return;
        }

        setSelectedToolIdx(idx => Math.min(idx, collapsibleToolIds.length - 1));
    }, [collapsibleToolIds]);

    useInput((input, key) => {
        if (key.ctrl && input === "c") {
            agent.abort();
            exit();
            return;
        }

        if (collapsibleToolIds.length === 0) {
            return;
        }

        if (input === "\x10") { // Ctrl+P
            setSelectedToolIdx(idx => Math.max(0, idx - 1));
            return;
        }

        if (input === "\x0e") { // Ctrl+N
            setSelectedToolIdx(idx => Math.min(collapsibleToolIds.length - 1, idx + 1));
            return;
        }

        if (input === "\x0f") { // Ctrl+O
            const selectedId = collapsibleToolIds[selectedToolIdx];
            if (!selectedId) return;
            setExpandedToolIds(prev => {
                const next = new Set(prev);
                if (next.has(selectedId)) next.delete(selectedId);
                else next.add(selectedId);
                return next;
            });
        }
    });

    const handleSubmit = useCallback((text: string) => {
        if (text.startsWith("/")) {
            handleSlashCommand(text, exit, addSystemMsg, agent);
            return;
        }
        submit(text);
    }, [exit, addSystemMsg, submit, agent]);

    return (
        <>
            <Static items={staticItems}>
                {(item: UIMessage) => <MessageRenderer key={item.id} message={item} />}
            </Static>

            {transientItems.map(item => (
                <MessageRenderer
                    key={item.id}
                    message={item}
                    isSelected={item.type === "tool_use" && item.id === collapsibleToolIds[selectedToolIdx]}
                    isExpanded={expandedToolIds.has(item.id)}
                />
            ))}

            {pendingPermission && (
                <PermissionDialog
                    request={{
                        id: pendingPermission.permissionRequestId!,
                        toolName: pendingPermission.toolName!,
                        args: pendingPermission.toolArgs ?? {},
                    }}
                    onResolve={(approved, value) => {
                        const persist = value === "always" ? "session" as const : null;
                        resolvePermission(approved, persist);
                    }}
                />
            )}

            {!isStreaming && !pendingPermission && (
                <Box flexDirection="column" width="100%">
                    {isLoading && !hasStreamedThisTurn && <Spinner />}

                    {!isLoading && (
                        <PromptInput
                            modelId={modelId}
                            onSubmit={handleSubmit}
                            disabled={false}
                        />
                    )}

                    {!isLoading && (
                        <StatusBar
                            tokenUsage={tokenUsage}
                            turnCount={turnCount}
                            isLoading={isLoading}
                        />
                    )}
                </Box>
            )}
            {!isStreaming && !isLoading && <Newline />}
        </>
    );
}

// ── 消息路由器 ───────────────────────────────────────────────────

function MessageRenderer({
    message,
    isSelected = false,
    isExpanded = false,
}: {
    message: UIMessage;
    isSelected?: boolean;
    isExpanded?: boolean;
}) {
    const theme = useTheme();

    switch (message.type) {
        case "user":
            return (
                <Box>
                    <Text bold color={theme.brand}>❯ </Text>
                    <Text bold>{message.content}</Text>
                </Box>
            );

        case "assistant_text":
            return <AssistantText text={message.content} compact={!message.completed} />;

        case "tool_use":
            return (
                <ToolUse
                    name={message.toolName!}
                    args={message.toolArgs ?? {}}
                    status={message.status}
                    result={message.toolResult}
                    selected={isSelected}
                    expanded={isExpanded}
                />
            );

        case "tool_result":
        case "tool_error":
            return null;

        case "permission_request":
            return <SystemNotice
                text={message.content}
                level={message.completed ? "info" : "warning"}
            />;

        case "system":
            return <SystemNotice text={message.content} level={message.content.startsWith("Error") ? "error" : "info"} />;

        default:
            return null;
    }
}

function handleSlashCommand(
    input: string,
    exit: () => void,
    addSystemMessage: (text: string) => void,
    agent: Agent,
) {
    const parts = input.slice(1).trim().split(/\s+/);
    const cmd = parts[0];
    switch (cmd?.toLowerCase()) {
        case "exit":
        case "quit":
            exit();
            break;
        case "compact": {
            addSystemMessage("Compacting context...");
            (async () => {
                for await (const event of agent.compact()) {
                    if (event.type === "context_compact") {
                        addSystemMessage(
                            `Context compacted: ${event.tokensBefore} → ${event.tokensAfter} tokens`,
                        );
                    }
                }
            })();
            break;
        }
        case "status": {
            const stats = agent.getContextStats();
            const lines = [
                "Context status:",
                `  Tokens: ${stats.tokens} (${stats.utilization}% used)`,
                `  Messages: ${stats.messages}`,
                `  Compactions: ${stats.compacts}`,
                `  Tracked files: ${stats.trackedFiles}`,
                `  Indexed topics: ${stats.indexedCompacts}`,
            ];
            if (stats.lastRecall.recovered) {
                lines.push(`  Last recall: ${stats.lastRecall.tokensUsed} tokens recovered (${stats.lastRecall.matchCount} matches)`);
            } else if (stats.indexedCompacts > 0) {
                lines.push(`  Last recall: no match`);
            }
            addSystemMessage(lines.join("\n"));
            break;
        }
        case "mode": {
            const newMode = agent.cyclePermissionMode();
            addSystemMessage(`Permission mode: ${newMode}`);
            break;
        }
        case "cost": {
            const summary = agent.costs.format();
            addSystemMessage(`Session costs: ${summary}`);
            break;
        }
        case "workflow": {
            const wm = agent.workflows;
            if (!wm) {
                addSystemMessage("Workflow system not available.");
                break;
            }
            const subCmd = input.slice(1).trim().split(/\s+/)[1];
            if (!subCmd || subCmd === "list") {
                const info = wm.getInfo();
                if (info.length === 0) {
                    addSystemMessage("No workflows registered.");
                } else {
                    const lines = info.map(w =>
                        `  ${w.active ? "●" : "○"} ${w.name} — ${w.description}`,
                    );
                    addSystemMessage(`Workflows:\n${lines.join("\n")}`);
                }
            } else if (subCmd === "off") {
                wm.deactivate();
                addSystemMessage("Workflow deactivated. All prompt modules active.");
            } else {
                wm.activate(subCmd).then(() => {
                    addSystemMessage(`Workflow activated: ${subCmd}`);
                }).catch((err: Error) => {
                    addSystemMessage(`Failed: ${err.message}`);
                });
            }
            break;
        }
        case "scaffold": {
            const scaffoldType = parts[1];
            const scaffoldDomain = parts.slice(2).join(" ");
            const validTypes = ["agent", "workflow", "subagent", "skill", "mcp"];
            if (!scaffoldType || !validTypes.includes(scaffoldType)) {
                addSystemMessage([
                    "Usage: /scaffold <type> <domain description>",
                    "",
                    "Types:",
                    "  agent      — Generate .agent/config.toml for a domain",
                    "  workflow   — Generate a workflow definition",
                    "  subagent   — Generate subagent config + skill",
                    "  skill      — Generate a SKILL.md file",
                    "  mcp        — Generate MCP server configuration",
                    "",
                    "Examples:",
                    "  /scaffold agent 前端 React + TypeScript 开发",
                    "  /scaffold skill Python 数据分析与可视化",
                    "  /scaffold subagent DevOps CI/CD 自动化",
                    "  /scaffold workflow 安全审计",
                    "  /scaffold mcp GitHub + PostgreSQL 集成",
                ].join("\n"));
                break;
            }
            if (!scaffoldDomain) {
                addSystemMessage("Please provide a domain description. Example: /scaffold skill Python 数据分析");
                break;
            }
            addSystemMessage(`Generating ${scaffoldType} scaffold for: ${scaffoldDomain}...`);
            // Scaffold execution is delegated to the agent via a user message
            // so that the agent can use write_file to save the generated files
            const scaffoldInstruction =
                `Use the scaffold system to generate a "${scaffoldType}" template for the domain: "${scaffoldDomain}". ` +
                `Generate the configuration files and write them to disk. Show the user what was created.`;
            (async () => {
                for await (const _event of agent.run(scaffoldInstruction)) {
                    // Events handled by the normal UI flow
                }
            })();
            break;
        }
        case "plan": {
            const planSubCmd = parts[1];
            if (planSubCmd === "list" || planSubCmd === "status") {
                (async () => {
                    for await (const _event of agent.run(
                        "Show the current plan status using plan_status tool.",
                    )) { /* UI flow handles events */ }
                })();
            } else if (planSubCmd) {
                const planGoal = parts.slice(1).join(" ");
                addSystemMessage(`Creating plan for: ${planGoal}`);
                (async () => {
                    for await (const _event of agent.run(
                        `Create a plan for the following goal using the plan tool: ${planGoal}`,
                    )) { /* UI flow handles events */ }
                })();
            } else {
                addSystemMessage([
                    "Usage: /plan <goal description>",
                    "       /plan status    — Show current plan status",
                    "       /plan list      — List all plans",
                    "",
                    "Examples:",
                    "  /plan 将项目从 JavaScript 迁移到 TypeScript",
                    "  /plan 实现用户认证系统（注册、登录、重置密码）",
                ].join("\n"));
            }
            break;
        }
        case "help":
            addSystemMessage([
                "Available commands:",
                "  /help              — Show this message",
                "  /compact           — Force context compaction",
                "  /status            — Show context usage stats",
                "  /mode              — Cycle permission mode",
                "  /cost              — Show session cost summary",
                "  /workflow [name]   — Switch workflow (list/off/<name>)",
                "  /tools             — List all registered tools",
                "  /plan <goal>       — Create an execution plan",
                "  /scaffold <type>   — Generate domain config (agent/workflow/subagent/skill/mcp)",
                "  /exit              — Exit the program",
                "  /quit              — Exit the program",
                "",
                "Shortcuts:",
                "  Ctrl+C       — Abort / Exit",
                "  Option+Enter — New line in input",
            ].join("\n"));
            break;
        default:
            addSystemMessage(`Unknown command: /${cmd}  (try /help)`);
            break;
    }
}
