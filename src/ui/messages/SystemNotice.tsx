// ── 系统通知 ─────────────────────────────────────────────────────
// 显示压缩、中断、错误等系统级消息。

import React from "react";
import { Text, Box } from "ink";
import { useTheme } from "../hooks/use-registry.js";

interface SystemNoticeProps {
    text: string;
    level?: "info" | "warning" | "error";
}

export function SystemNotice({ text, level = "info" }: SystemNoticeProps) {
    const theme = useTheme();

    const colorMap = {
        info: theme.secondaryText,
        warning: theme.warning,
        error: theme.error,
    };

    const symbolMap = {
        info: "ℹ",
        warning: "⚠",
        error: "✗",
    };

    return (
        <Box>
            <Text color={colorMap[level]}>
                {symbolMap[level]} {text}
            </Text>
        </Box>
    );
}
