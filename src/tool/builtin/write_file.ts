// ── Write File 工具 ──────────────────────────────────────────────
// 将内容写入文件。自动创建不存在的目录。

import { z } from "zod";
import { writeFile, mkdir } from "fs/promises";
import { resolve, dirname, isAbsolute } from "path";
import type { ToolDef, ToolResult, ToolContext } from "../types.js";

const inputSchema = z.object({
    path: z.string().describe("File path (absolute or relative to cwd)"),
    content: z.string().describe("The complete file content to write"),
});

type WriteFileInput = z.infer<typeof inputSchema>;

export const writeFileTool: ToolDef<WriteFileInput> = {
    name: "write_file",
    description: `Write content to a file, creating it if it doesn't exist.

This will overwrite the entire file. For partial modifications, use the edit_file tool instead.

Use this tool to:
- Create new files
- Rewrite entire files when the changes are extensive

The parent directory will be created automatically if it doesn't exist.`,

    inputSchema,
    isReadOnly: false,

    async execute(input: WriteFileInput, ctx: ToolContext): Promise<ToolResult> {
        const filePath = isAbsolute(input.path) ? input.path : resolve(ctx.cwd, input.path);

        try {
            await mkdir(dirname(filePath), { recursive: true });
            await writeFile(filePath, input.content, "utf-8");

            const lineCount = input.content.split("\n").length;
            return {
                success: true,
                output: `Wrote ${lineCount} lines to ${filePath}`,
            };
        } catch (err: any) {
            return { success: false, error: `Failed to write ${filePath}: ${err.message}` };
        }
    },
};
