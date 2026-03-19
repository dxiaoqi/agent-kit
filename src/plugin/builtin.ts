// ── 内置 Plugin：Code Tools ──────────────────────────────────────
// 将所有代码操作工具注册为一个 Plugin。

import type { Plugin } from "./types.js";
import {
    bashTool, readFileTool, writeFileTool, editFileTool,
    globTool, grepTool, todoWriteTool, todoReadTool,
    taskTool, taskOutputTool,
} from "../tool/builtin/index.js";

export const codeToolsPlugin: Plugin = {
    name: "@agent-kit/tools-code",
    version: "0.1.0",
    description: "Built-in code tools: bash, read/write/edit_file, glob, grep, todo, task",

    setup(ctx) {
        ctx.registerTool(bashTool);
        ctx.registerTool(readFileTool);
        ctx.registerTool(writeFileTool);
        ctx.registerTool(editFileTool);
        ctx.registerTool(globTool);
        ctx.registerTool(grepTool);
        ctx.registerTool(todoWriteTool);
        ctx.registerTool(todoReadTool);
        ctx.registerTool(taskTool);
        ctx.registerTool(taskOutputTool);
    },
};
