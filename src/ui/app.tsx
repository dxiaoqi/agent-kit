// ── App 根组件 ───────────────────────────────────────────────────
// Ink render 入口：提供 UIContext（Theme + UIRegistry），包裹 REPL。
// Logo 在 Ink 启动前用 chalk 打印，避免干扰 Static/Transient 边界。

import React from "react";
import { render } from "ink";
import chalk from "chalk";
import { UIContext, type UIContextValue } from "./hooks/use-registry.js";
import { UIRegistry } from "./registry.js";
import type { Theme } from "./theme.js";
import type { Agent } from "../kernel/agent.js";
import { REPL } from "./screens/REPL.js";

interface AppProps {
    agent: Agent;
    modelId: string;
    theme: Theme;
    registry: UIRegistry;
}

function App({ agent, modelId, theme, registry }: AppProps) {
    const ctxValue: UIContextValue = { registry, theme };

    return (
        <UIContext.Provider value={ctxValue}>
            <REPL agent={agent} modelId={modelId} />
        </UIContext.Provider>
    );
}

export function startApp(agent: Agent, modelId: string, theme: Theme, registry: UIRegistry) {
    // Logo 在 Ink 接管 stdout 之前打印
    const c = chalk.hex(theme.brand);
    const d = chalk.hex(theme.secondaryText);
    console.log(c.bold(`\n╭─ agent-kit v0.1.0 ─╮`));
    console.log(d(`│ Model: ${modelId.padEnd(14)} │`));
    console.log(d(`│ /help for commands    │`));
    console.log(c.bold(`╰──────────────────────╯\n`));

    const instance = render(
        <App agent={agent} modelId={modelId} theme={theme} registry={registry} />,
    );

    return instance;
}
