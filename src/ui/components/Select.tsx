// ── Select 组件 ──────────────────────────────────────────────────
// 键盘上下选择器，用于权限选项和斜杠命令。

import React, { useState } from "react";
import { Text, Box, useInput } from "ink";
import { useTheme } from "../hooks/use-registry.js";

interface SelectOption {
    label: string;
    value: string;
}

interface SelectProps {
    options: SelectOption[];
    onSelect: (value: string) => void;
    prefix?: string;
}

export function Select({ options, onSelect, prefix }: SelectProps) {
    const theme = useTheme();
    const [selectedIdx, setSelectedIdx] = useState(0);

    useInput((input, key) => {
        if (key.upArrow) {
            setSelectedIdx(i => Math.max(0, i - 1));
        } else if (key.downArrow) {
            setSelectedIdx(i => Math.min(options.length - 1, i + 1));
        } else if (key.return) {
            onSelect(options[selectedIdx].value);
        }
    });

    return (
        <Box flexDirection="column">
            {prefix && <Text color={theme.secondaryText}>{prefix}</Text>}
            {options.map((opt, i) => {
                const isSelected = i === selectedIdx;
                return (
                    <Text key={opt.value}>
                        <Text color={isSelected ? theme.brand : theme.secondaryText}>
                            {isSelected ? "❯ " : "  "}
                        </Text>
                        <Text color={isSelected ? theme.text : theme.secondaryText}>
                            {opt.label}
                        </Text>
                    </Text>
                );
            })}
        </Box>
    );
}
