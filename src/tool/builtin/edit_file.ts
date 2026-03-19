// ── Edit File 工具 ───────────────────────────────────────────────
// 精确字符串替换：在文件中找到 old_string 并替换为 new_string。
// 与 Claude Code 的 str_replace_editor 对齐。

import { z } from "zod";
import { readFile, writeFile } from "fs/promises";
import { resolve, isAbsolute } from "path";
import type { ToolDef, ToolResult, ToolContext } from "../types.js";

const inputSchema = z.object({
    path: z.string().describe("File path (absolute or relative to cwd)"),
    old_string: z.string().describe("The exact string to find in the file"),
    new_string: z.string().describe("The replacement string"),
});

type EditFileInput = z.infer<typeof inputSchema>;

export const editFileTool: ToolDef<EditFileInput> = {
    name: "edit_file",
    description: `Make a targeted edit to a file by replacing an exact string match.

Rules:
- old_string must appear EXACTLY once in the file (including whitespace and indentation)
- If old_string appears multiple times, the edit will fail — provide more context to make it unique
- Preserve the exact indentation of the surrounding code
- To insert new code, use an empty new_string and place old_string at the insertion point context

This is the preferred way to make small, precise changes. For completely rewriting a file, use write_file instead.`,

    inputSchema,
    isReadOnly: false,

    async execute(input: EditFileInput, ctx: ToolContext): Promise<ToolResult> {
        const filePath = isAbsolute(input.path) ? input.path : resolve(ctx.cwd, input.path);

        try {
            const content = await readFile(filePath, "utf-8");

            const occurrences = countOccurrences(content, input.old_string);

            if (occurrences === 0) {
                return {
                    success: false,
                    error: `old_string not found in ${filePath}. Make sure it matches exactly (including whitespace).`,
                };
            }

            if (occurrences > 1) {
                return {
                    success: false,
                    error: `old_string found ${occurrences} times in ${filePath}. Provide more surrounding context to make it unique.`,
                };
            }

            const newContent = content.replace(input.old_string, input.new_string);
            await writeFile(filePath, newContent, "utf-8");

            const oldLines = input.old_string.split("\n").length;
            const newLines = input.new_string.split("\n").length;

            return {
                success: true,
                output: `Edited ${filePath}: replaced ${oldLines} lines with ${newLines} lines`,
            };
        } catch (err: any) {
            if (err.code === "ENOENT") {
                return { success: false, error: `File not found: ${filePath}` };
            }
            return { success: false, error: `Failed to edit ${filePath}: ${err.message}` };
        }
    },
};

function countOccurrences(text: string, search: string): number {
    let count = 0;
    let pos = 0;
    while ((pos = text.indexOf(search, pos)) !== -1) {
        count++;
        pos += search.length;
    }
    return count;
}
