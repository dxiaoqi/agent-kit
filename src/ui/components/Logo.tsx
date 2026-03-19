// ── Logo 组件 ────────────────────────────────────────────────────
// 启动时显示的横幅。

import React from "react";
import { Text, Box } from "ink";
import { useTheme } from "../hooks/use-registry.js";

interface LogoProps {
    modelId: string;
    version?: string;
}

export function Logo({ modelId, version = "0.1.0" }: LogoProps) {
    const theme = useTheme();

    return (
        <Box flexDirection="column" marginBottom={1}>
            <Text bold color={theme.brand}>
                ╭─ agent-kit v{version} ─╮
            </Text>
            <Text color={theme.secondaryText}>
                │ Model: {modelId.padEnd(14)} │
            </Text>
            <Text color={theme.secondaryText}>
                │ /help for commands    │
            </Text>
            <Text bold color={theme.brand}>
                ╰──────────────────────╯
            </Text>
        </Box>
    );
}
