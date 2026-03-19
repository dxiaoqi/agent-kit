// ── 兜底权限渲染 ─────────────────────────────────────────────────
// 当没有自定义 PermissionRenderer 时使用的默认渲染。

import React from "react";
import { Text, Box } from "ink";
import type { Theme } from "../theme.js";

interface FallbackPermissionProps {
    toolName: string;
    args: Record<string, unknown>;
    theme: Theme;
}

export function FallbackPermission({ toolName, args, theme }: FallbackPermissionProps) {
    const argsStr = JSON.stringify(args, null, 2);
    const lines = argsStr.split("\n");
    const display = lines.length > 15
        ? [...lines.slice(0, 12), "  ...", `  (${lines.length - 12} more lines)`].join("\n")
        : argsStr;

    return (
        <Box flexDirection="column">
            <Text bold>{toolName}</Text>
            <Text color={theme.secondaryText}>{display}</Text>
        </Box>
    );
}
