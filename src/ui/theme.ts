// ── 主题系统 ─────────────────────────────────────────────────────
// 定义终端 UI 的色彩变量，支持 dark / light / daltonized 三种预设。
// 通过 React Context 在组件树中传递。

export interface Theme {
    name: string;

    brand: string;

    inputBorder: string;
    permissionBorder: string;
    secondaryBorder: string;

    text: string;
    secondaryText: string;
    suggestion: string;

    success: string;
    error: string;
    warning: string;

    // 工具执行符号
    toolPending: string;
    toolSpinner: string;
    toolResult: string;

    diff: {
        added: string;
        removed: string;
        addedDimmed: string;
        removedDimmed: string;
    };
}

export const darkTheme: Theme = {
    name: "dark",
    brand: "#FFC233",
    inputBorder: "#818cf8",
    permissionBorder: "#b1b9f9",
    secondaryBorder: "#6b7280",
    text: "#e5e7eb",
    secondaryText: "#9ca3af",
    suggestion: "#60a5fa",
    success: "#4eba65",
    error: "#ff6b80",
    warning: "#ffc107",
    toolPending: "#818cf8",
    toolSpinner: "#FFC233",
    toolResult: "#9ca3af",
    diff: {
        added: "#4eba65",
        removed: "#ff6b80",
        addedDimmed: "#2d6a3a",
        removedDimmed: "#993344",
    },
};

export const lightTheme: Theme = {
    name: "light",
    brand: "#d97706",
    inputBorder: "#6366f1",
    permissionBorder: "#818cf8",
    secondaryBorder: "#d1d5db",
    text: "#1f2937",
    secondaryText: "#6b7280",
    suggestion: "#2563eb",
    success: "#16a34a",
    error: "#dc2626",
    warning: "#ca8a04",
    toolPending: "#6366f1",
    toolSpinner: "#d97706",
    toolResult: "#6b7280",
    diff: {
        added: "#16a34a",
        removed: "#dc2626",
        addedDimmed: "#bbf7d0",
        removedDimmed: "#fecaca",
    },
};

export function getTheme(name?: string): Theme {
    switch (name) {
        case "light":
            return lightTheme;
        case "dark":
        default:
            return darkTheme;
    }
}
