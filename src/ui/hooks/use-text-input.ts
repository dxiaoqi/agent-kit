// ── useTextInput Hook ────────────────────────────────────────────
// 文本输入管理：光标位置、多行支持（Option+Enter）、粘贴检测。

import { useState, useCallback } from "react";
import { useInput } from "ink";

interface UseTextInputOptions {
    onSubmit: (text: string) => void;
    disabled?: boolean;
    multiline?: boolean;
}

interface UseTextInputReturn {
    value: string;
    setValue: (v: string) => void;
    cursorOffset: number;
}

export function useTextInput({ onSubmit, disabled = false, multiline = true }: UseTextInputOptions): UseTextInputReturn {
    const [value, setValue] = useState("");
    const [cursorOffset, setCursorOffset] = useState(0);

    useInput((input, key) => {
        if (disabled) return;

        // Submit on Enter (but Option+Enter for newline in multiline)
        if (key.return) {
            if (multiline && key.meta) {
                setValue(v => v.slice(0, cursorOffset) + "\n" + v.slice(cursorOffset));
                setCursorOffset(o => o + 1);
                return;
            }
            if (value.trim()) {
                onSubmit(value);
                setValue("");
                setCursorOffset(0);
            }
            return;
        }

        // Backspace
        if (key.backspace || key.delete) {
            if (cursorOffset > 0) {
                setValue(v => v.slice(0, cursorOffset - 1) + v.slice(cursorOffset));
                setCursorOffset(o => o - 1);
            }
            return;
        }

        // Arrow keys
        if (key.leftArrow) {
            setCursorOffset(o => Math.max(0, o - 1));
            return;
        }
        if (key.rightArrow) {
            setCursorOffset(o => Math.min(value.length, o + 1));
            return;
        }

        // Ctrl+A / Ctrl+E (home/end)
        if (input === "\x01") { // Ctrl+A
            setCursorOffset(0);
            return;
        }
        if (input === "\x05") { // Ctrl+E
            setCursorOffset(value.length);
            return;
        }

        // Ctrl+U (clear line)
        if (input === "\x15") {
            setValue("");
            setCursorOffset(0);
            return;
        }

        // Regular character input
        if (input && !key.ctrl && !key.meta) {
            setValue(v => v.slice(0, cursorOffset) + input + v.slice(cursorOffset));
            setCursorOffset(o => o + input.length);
        }
    }, { isActive: !disabled });

    const setValueWrapped = useCallback((v: string) => {
        setValue(v);
        setCursorOffset(v.length);
    }, []);

    return { value, setValue: setValueWrapped, cursorOffset };
}
