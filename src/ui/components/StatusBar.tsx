// ── 状态栏组件 ───────────────────────────────────────────────────
// 底部状态栏：token 用量 + 成本 + 插槽项 + 快捷键提示。

import React from "react";
import { Text, Box } from "ink";
import { useTheme, useRegistry } from "../hooks/use-registry.js";
import type { TokenUsage } from "../../provider/types.js";

interface StatusBarProps {
    tokenUsage?: TokenUsage;
    cost?: number;
    turnCount?: number;
    isLoading?: boolean;
    stateGetter?: <T>(key: string) => T | undefined;
}

export function StatusBar({ tokenUsage, cost, turnCount, isLoading, stateGetter }: StatusBarProps) {
    const theme = useTheme();
    const registry = useRegistry();
    const customItems = registry.getStatusBarItems();

    const defaultGetter = <T,>(_key: string): T | undefined => undefined;
    const getState = stateGetter ?? defaultGetter;

    return (
        <Box marginTop={0}>
            <Text color={theme.secondaryText}>
                {tokenUsage ? `tokens: ${formatNumber(tokenUsage.totalTokens)}` : ""}
                {cost !== undefined ? ` · $${cost.toFixed(4)}` : ""}
                {turnCount !== undefined ? ` · turns: ${turnCount}` : ""}
                {isLoading ? " · ⏳" : ""}
            </Text>

            {customItems.map(item => (
                <Box key={item.id} marginLeft={1}>
                    {item.render({ getState }, theme)}
                </Box>
            ))}

            <Box flexGrow={1} />
            <Text color={theme.secondaryText}>
                ESC to interrupt · /help
            </Text>
        </Box>
    );
}

function formatNumber(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
    return String(n);
}
