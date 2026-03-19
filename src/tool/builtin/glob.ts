// ── Glob 工具 ────────────────────────────────────────────────────
// 使用 glob pattern 搜索文件路径。

import { z } from "zod";
import { resolve, isAbsolute, relative } from "path";
import { readdir, stat } from "fs/promises";
import type { ToolDef, ToolResult, ToolContext } from "../types.js";

const inputSchema = z.object({
    pattern: z.string().describe("Glob-like pattern (e.g. '**/*.ts', 'src/**/*.test.ts')"),
    directory: z.string().optional().describe("Base directory to search from (default: cwd)"),
    maxResults: z.number().optional().describe("Maximum results to return (default: 200)"),
});

type GlobInput = z.infer<typeof inputSchema>;

export const globTool: ToolDef<GlobInput> = {
    name: "glob",
    description: `Find files matching a glob pattern.

Returns matching file paths sorted by modification time (newest first).

Supported patterns:
- "*.ts" matches .ts files in current directory
- "**/*.ts" matches .ts files recursively
- "src/**/*.test.ts" matches test files under src/

Use this to discover file structure before reading or editing files.`,

    inputSchema,
    isReadOnly: true,

    async execute(input: GlobInput, ctx: ToolContext): Promise<ToolResult> {
        const baseDir = input.directory
            ? (isAbsolute(input.directory) ? input.directory : resolve(ctx.cwd, input.directory))
            : ctx.cwd;
        const maxResults = input.maxResults ?? 200;

        try {
            const regex = globToRegex(input.pattern);
            const matches: { path: string; mtime: number }[] = [];

            await walkDir(baseDir, baseDir, regex, matches, maxResults);

            matches.sort((a, b) => b.mtime - a.mtime);

            if (matches.length === 0) {
                return { success: true, output: `No files matching "${input.pattern}" in ${baseDir}` };
            }

            const output = matches
                .map(m => relative(ctx.cwd, m.path))
                .join("\n");

            return {
                success: true,
                output: `Found ${matches.length} file(s):\n${output}`,
            };
        } catch (err: any) {
            return { success: false, error: `Glob failed: ${err.message}` };
        }
    },
};

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".next", "__pycache__", ".venv", "target"]);

async function walkDir(
    dir: string,
    baseDir: string,
    regex: RegExp,
    matches: { path: string; mtime: number }[],
    maxResults: number,
): Promise<void> {
    if (matches.length >= maxResults) return;

    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        if (matches.length >= maxResults) return;

        const fullPath = resolve(dir, entry.name);
        const relPath = relative(baseDir, fullPath);

        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
                await walkDir(fullPath, baseDir, regex, matches, maxResults);
            }
        } else if (entry.isFile()) {
            if (regex.test(relPath)) {
                try {
                    const s = await stat(fullPath);
                    matches.push({ path: fullPath, mtime: s.mtimeMs });
                } catch {
                    matches.push({ path: fullPath, mtime: 0 });
                }
            }
        }
    }
}

function globToRegex(pattern: string): RegExp {
    let reg = pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "{{DOUBLESTAR}}")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]")
        .replace(/\{\{DOUBLESTAR\}\}/g, ".*");

    if (!pattern.includes("/")) {
        reg = "(.*/)?" + reg;
    }

    return new RegExp(`^${reg}$`);
}
