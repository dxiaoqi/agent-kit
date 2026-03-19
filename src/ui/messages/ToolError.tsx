// ── 工具错误显示 ─────────────────────────────────────────────────

import React from "react";
import { Text, Box } from "ink";
import { useTheme } from "../hooks/use-registry.js";

interface ToolErrorProps {
    name: string;
    error: string;
}

export function ToolError({ name, error }: ToolErrorProps) {
    const theme = useTheme();

    const lines = error.split("\n");
    const display = lines.length > 10
        ? [...lines.slice(0, 10), `... ${lines.length - 10} more lines`].join("\n")
        : error;

    return (
        <Box marginLeft={2} flexDirection="column">
            <Text color={theme.error}>✗ {name} failed:</Text>
            <Text color={theme.error}>{display}</Text>
        </Box>
    );
}
