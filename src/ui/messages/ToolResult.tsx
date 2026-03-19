// ── 工具结果显示 ─────────────────────────────────────────────────
// 格式：⎿ tool output (truncated)

import React from "react";
import { Text, Box } from "ink";
import { useTheme, useRegistry } from "../hooks/use-registry.js";
import { Truncate } from "../components/Truncate.js";

interface ToolResultProps {
    name: string;
    result: { success: boolean; output?: string; error?: string };
}

export function ToolResult({ name, result }: ToolResultProps) {
    const theme = useTheme();
    const registry = useRegistry();
    const renderer = registry.getToolRenderer(name);

    if (renderer?.renderToolResult) {
        return (
            <Box marginLeft={2}>
                <Text color={theme.toolResult}>⎿ </Text>
                {renderer.renderToolResult(result, theme)}
            </Box>
        );
    }

    const content = result.success ? result.output ?? "" : result.error ?? "Unknown error";

    return (
        <Box marginLeft={2} flexDirection="column">
            <Box>
                <Text color={result.success ? theme.toolResult : theme.error}>⎿ </Text>
                <Truncate text={content} />
            </Box>
        </Box>
    );
}
