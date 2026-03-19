// ── Truncate 组件 ────────────────────────────────────────────────
// 长输出截断：保留首 N 行 + "... X lines omitted" + 尾 N 行。

import React from "react";
import { Text, Box } from "ink";
import { useTheme } from "../hooks/use-registry.js";

interface TruncateProps {
    text: string;
    maxLines?: number;
    headLines?: number;
    tailLines?: number;
}

export function Truncate({ text, maxLines = 50, headLines = 25, tailLines = 25 }: TruncateProps) {
    const theme = useTheme();
    const lines = text.split("\n");

    if (lines.length <= maxLines) {
        return <Text>{text}</Text>;
    }

    const head = lines.slice(0, headLines).join("\n");
    const tail = lines.slice(-tailLines).join("\n");
    const omitted = lines.length - headLines - tailLines;

    return (
        <Box flexDirection="column">
            <Text>{head}</Text>
            <Text color={theme.secondaryText}>
                {"\n"}... {omitted} lines omitted ...{"\n"}
            </Text>
            <Text>{tail}</Text>
        </Box>
    );
}
