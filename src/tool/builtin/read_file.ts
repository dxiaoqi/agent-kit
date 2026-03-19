// ── Read File 工具 ───────────────────────────────────────────────
// 读取文件内容，支持行号范围。返回带行号的文本。

import { z } from "zod";
import { readFile } from "fs/promises";
import { resolve, isAbsolute } from "path";
import type { ToolDef, ToolResult, ToolContext } from "../types.js";

const inputSchema = z.object({
    path: z.string().describe("File path (absolute or relative to cwd)"),
    offset: z.number().optional().describe("Starting line number (1-based, default: 1)"),
    limit: z.number().optional().describe("Number of lines to read (default: all)"),
});

type ReadFileInput = z.infer<typeof inputSchema>;

export const readFileTool: ToolDef<ReadFileInput> = {
    name: "read_file",
    description: `Read a file from the filesystem.

Returns the file contents with line numbers. For large files, use offset and limit to read specific sections.

Use this tool to:
- Examine source code before making changes
- Read configuration files
- Check file contents

The output includes line numbers for easy reference:
  1|first line
  2|second line`,

    inputSchema,
    isReadOnly: true,

    async execute(input: ReadFileInput, ctx: ToolContext): Promise<ToolResult> {
        const filePath = isAbsolute(input.path) ? input.path : resolve(ctx.cwd, input.path);

        try {
            const raw = await readFile(filePath, "utf-8");
            const allLines = raw.split("\n");
            const total = allLines.length;

            const offset = Math.max(1, input.offset ?? 1);
            const limit = input.limit ?? total;
            const start = offset - 1;
            const end = Math.min(start + limit, total);
            const lines = allLines.slice(start, end);

            const maxLineNum = end;
            const pad = String(maxLineNum).length;

            const numbered = lines
                .map((line, i) => `${String(start + i + 1).padStart(pad)}|${line}`)
                .join("\n");

            const header = input.offset || input.limit
                ? `[${filePath}] lines ${offset}-${end} of ${total}\n`
                : `[${filePath}] ${total} lines\n`;

            return { success: true, output: header + numbered };
        } catch (err: any) {
            if (err.code === "ENOENT") {
                return { success: false, error: `File not found: ${filePath}` };
            }
            if (err.code === "EISDIR") {
                return { success: false, error: `Path is a directory: ${filePath}` };
            }
            return { success: false, error: `Failed to read ${filePath}: ${err.message}` };
        }
    },
};
