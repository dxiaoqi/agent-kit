// ── Assistant 文本消息 ───────────────────────────────────────────

import React from "react";
import { Box, Text } from "ink";
import wrapAnsi from "wrap-ansi";
import { Markdown } from "../components/Markdown.js";

interface AssistantTextProps {
    text: string;
    compact?: boolean;
}

export function AssistantText({ text, compact = false }: AssistantTextProps) {
    if (compact) {
        const width = Math.max(20, (process.stdout.columns ?? 80) - 1);
        const wrappedText = wrapAnsi(text, width, {
            hard: false,
            trim: false,
            wordWrap: true,
        });

        return (
            <Box width="100%">
                <Text>{wrappedText}</Text>
            </Box>
        );
    }

    return (
        <Box flexDirection="column" marginBottom={1} width="100%">
            <Markdown text={text} />
        </Box>
    );
}
