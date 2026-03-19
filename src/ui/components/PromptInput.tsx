// ── 输入框组件 ───────────────────────────────────────────────────
// 复刻 Claude Code 的输入框：边框 + 模型标签 + 光标。

import React from "react";
import { Text, Box } from "ink";
import { useTheme } from "../hooks/use-registry.js";
import { useTextInput } from "../hooks/use-text-input.js";

interface PromptInputProps {
    modelId: string;
    onSubmit: (text: string) => void;
    disabled?: boolean;
}

export function PromptInput({ modelId, onSubmit, disabled = false }: PromptInputProps) {
    const theme = useTheme();
    const { value } = useTextInput({ onSubmit, disabled });

    const borderColor = disabled ? theme.secondaryBorder : theme.inputBorder;

    return (
        <Box
            borderStyle="round"
            borderColor={borderColor}
            paddingX={1}
            flexDirection="column"
        >
            <Box>
                <Text color={theme.secondaryText}>
                    {modelId} &gt;{" "}
                </Text>
                <Text color={disabled ? theme.secondaryText : theme.text}>
                    {value || (disabled ? "" : "Type your message...")}
                </Text>
                {!disabled && !value && (
                    <Text color={theme.secondaryText} dimColor>
                        {" "}(Option+Enter for newline)
                    </Text>
                )}
            </Box>
        </Box>
    );
}
