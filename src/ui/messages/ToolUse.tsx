// ── 工具调用显示 ─────────────────────────────────────────────────
// 显示工具调用的启动状态，支持 ToolRenderer 插槽。
// 格式复刻 Claude Code：⏺ tool_name(args...)

import React from "react";
import { Text, Box } from "ink";
import { useTheme, useRegistry } from "../hooks/use-registry.js";

interface ToolUseProps {
    name: string;
    args: Record<string, unknown>;
    status?: "pending" | "success" | "error";
    result?: { success: boolean; output?: string; error?: string };
    expanded?: boolean;
    selected?: boolean;
}

export function ToolUse({
    name,
    args,
    status = "pending",
    result,
    expanded = false,
    selected = false,
}: ToolUseProps) {
    const theme = useTheme();
    const registry = useRegistry();
    const renderer = registry.getToolRenderer(name);
    const statusColor = status === "success"
        ? theme.success
        : status === "error"
            ? theme.error
            : theme.warning;

    const content = result
        ? (result.success ? result.output ?? "" : result.error ?? "Unknown error")
        : "";

    if (renderer?.renderToolUse) {
        return (
            <Box flexDirection="column">
                <Box>
                    <Text color={selected ? theme.brand : theme.secondaryText}>{selected ? "❯ " : "  "}</Text>
                    <Text color={statusColor}>⏺ </Text>
                    {renderer.renderToolUse(args, theme)}
                </Box>
                {result && (
                    <ToolUseResultPreview
                        content={content}
                        expanded={expanded}
                        selected={selected}
                        success={result.success}
                    />
                )}
            </Box>
        );
    }

    const argsStr = formatArgs(args);

    return (
        <Box flexDirection="column">
            <Box>
                <Text color={selected ? theme.brand : theme.secondaryText}>{selected ? "❯ " : "  "}</Text>
                <Text color={statusColor}>⏺ </Text>
                <Text bold>{name}</Text>
                {argsStr && <Text color={theme.secondaryText}> {argsStr}</Text>}
            </Box>
            {result && (
                <ToolUseResultPreview
                    content={content}
                    expanded={expanded}
                    selected={selected}
                    success={result.success}
                />
            )}
        </Box>
    );
}

function ToolUseResultPreview({
    content,
    expanded,
    selected,
    success,
}: {
    content: string;
    expanded: boolean;
    selected: boolean;
    success: boolean;
}) {
    const theme = useTheme();
    const color = success ? theme.toolResult : theme.error;

    if (expanded) {
        return (
            <Box marginLeft={4} flexDirection="column">
                <Text color={color}>⎿</Text>
                <Text>{content || "(empty output)"}</Text>
                {selected && <Text color={theme.secondaryText}>Ctrl+O collapse</Text>}
            </Box>
        );
    }

    const firstLine = (content || "(empty output)").split("\n")[0] ?? "";
    const clipped = firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;

    return (
        <Box marginLeft={4}>
            <Text color={color}>⎿ </Text>
            <Text>{clipped}</Text>
            <Text color={theme.secondaryText}> ...</Text>
            {selected && <Text color={theme.secondaryText}> Ctrl+O expand</Text>}
        </Box>
    );
}

function formatArgs(args: Record<string, unknown>): string {
    const entries = Object.entries(args);
    if (entries.length === 0) return "";
    if (entries.length === 1) {
        const val = String(entries[0][1]);
        return val.length > 60 ? val.slice(0, 57) + "..." : val;
    }
    const str = JSON.stringify(args);
    return str.length > 80 ? str.slice(0, 77) + "..." : str;
}
