// ── Spinner 组件 ─────────────────────────────────────────────────
// 处理中动画：✻ + 随机动词 + 计时。

import React, { useState, useEffect, useRef } from "react";
import { Text } from "ink";
import { useTheme } from "../hooks/use-registry.js";

const SYMBOLS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const VERBS = [
    "Thinking", "Processing", "Analyzing", "Computing",
    "Pondering", "Crafting", "Generating", "Working",
];

export function Spinner({ detail }: { detail?: string }) {
    const theme = useTheme();
    const [frame, setFrame] = useState(0);
    const verb = useRef(VERBS[Math.floor(Math.random() * VERBS.length)]);
    const startTime = useRef(Date.now());
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setFrame(f => (f + 1) % SYMBOLS.length);
            setElapsed(Math.floor((Date.now() - startTime.current) / 1000));
        }, 120);
        return () => clearInterval(interval);
    }, []);

    const timeStr = elapsed > 0 ? ` ${elapsed}s` : "";

    return (
        <Text color={theme.toolSpinner}>
            {SYMBOLS[frame]} {verb.current}...{detail ? ` ${detail}` : ""}{timeStr}
        </Text>
    );
}
