// ── UIRegistry React Context ─────────────────────────────────────

import { createContext, useContext } from "react";
import type { UIRegistry } from "../registry.js";
import type { Theme } from "../theme.js";

export interface UIContextValue {
    registry: UIRegistry;
    theme: Theme;
}

export const UIContext = createContext<UIContextValue | null>(null);

export function useUI(): UIContextValue {
    const ctx = useContext(UIContext);
    if (!ctx) throw new Error("useUI must be used within <UIContext.Provider>");
    return ctx;
}

export function useTheme(): Theme {
    return useUI().theme;
}

export function useRegistry(): UIRegistry {
    return useUI().registry;
}
