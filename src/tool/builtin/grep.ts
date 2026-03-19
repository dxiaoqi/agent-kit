// ── Grep 工具 ────────────────────────────────────────────────────
// 搜索文件内容，支持正则表达式。
// 内置使用 Node.js 递归搜索，不依赖外部工具。

import { z } from "zod";
import { readdir, readFile, stat } from "fs/promises";
import { resolve, relative, isAbsolute } from "path";
import type { ToolDef, ToolResult, ToolContext } from "../types.js";

const inputSchema = z.object({
    pattern: z.string().describe("Search pattern (regex supported)"),
    directory: z.string().optional().describe("Directory to search in (default: cwd)"),
    include: z.string().optional().describe("File pattern to include (e.g. '*.ts')"),
    contextLines: z.number().optional().describe("Lines of context before/after each match (default: 2)"),
    maxResults: z.number().optional().describe("Maximum matches to return (default: 50)"),
    caseSensitive: z.boolean().optional().describe("Case sensitive search (default: true)"),
});

type GrepInput = z.infer<typeof inputSchema>;

export const grepTool: ToolDef<GrepInput> = {
    name: "grep",
    description: `Search file contents using a regex pattern.

Returns matching lines with file path, line numbers, and surrounding context.
Useful for finding function definitions, usages, or any text across the codebase.

The output format:
  path/to/file.ts
    10: matching line
    11- context line`,

    inputSchema,
    isReadOnly: true,

    async execute(input: GrepInput, ctx: ToolContext): Promise<ToolResult> {
        const baseDir = input.directory
            ? (isAbsolute(input.directory) ? input.directory : resolve(ctx.cwd, input.directory))
            : ctx.cwd;
        const contextLines = input.contextLines ?? 2;
        const maxResults = input.maxResults ?? 50;
        const flags = input.caseSensitive === false ? "gi" : "g";

        let regex: RegExp;
        try {
            regex = new RegExp(input.pattern, flags);
        } catch (err: any) {
            return { success: false, error: `Invalid regex: ${err.message}` };
        }

        const includeRegex = input.include ? filePatternToRegex(input.include) : null;
        const results: string[] = [];
        let totalMatches = 0;

        await searchDir(baseDir, baseDir, regex, includeRegex, contextLines, results, { count: 0, max: maxResults });

        for (const r of results) totalMatches++;

        if (results.length === 0) {
            return { success: true, output: `No matches for "${input.pattern}" in ${relative(ctx.cwd, baseDir) || "."}` };
        }

        const output = results.join("\n\n");
        return {
            success: true,
            output: `Found ${totalMatches} match(es):\n\n${output}`,
        };
    },
};

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".next", "__pycache__", ".venv", "target"]);
const BINARY_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf", ".eot", ".zip", ".gz", ".tar", ".pdf", ".exe", ".dll", ".so", ".dylib"]);

async function searchDir(
    dir: string,
    baseDir: string,
    regex: RegExp,
    includeRegex: RegExp | null,
    contextLines: number,
    results: string[],
    counter: { count: number; max: number },
): Promise<void> {
    if (counter.count >= counter.max) return;

    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        if (counter.count >= counter.max) return;

        const fullPath = resolve(dir, entry.name);

        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
                await searchDir(fullPath, baseDir, regex, includeRegex, contextLines, results, counter);
            }
        } else if (entry.isFile()) {
            const ext = entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase();
            if (BINARY_EXTENSIONS.has(ext)) continue;
            if (includeRegex && !includeRegex.test(entry.name)) continue;

            try {
                const s = await stat(fullPath);
                if (s.size > 512 * 1024) continue;

                const content = await readFile(fullPath, "utf-8");
                const lines = content.split("\n");
                const relPath = relative(baseDir, fullPath);

                const matchLines: number[] = [];
                for (let i = 0; i < lines.length; i++) {
                    regex.lastIndex = 0;
                    if (regex.test(lines[i])) {
                        matchLines.push(i);
                    }
                }

                if (matchLines.length === 0) continue;

                const parts: string[] = [`${relPath}`];
                const shown = new Set<number>();

                for (const lineIdx of matchLines) {
                    if (counter.count >= counter.max) break;
                    counter.count++;

                    const start = Math.max(0, lineIdx - contextLines);
                    const end = Math.min(lines.length - 1, lineIdx + contextLines);

                    for (let i = start; i <= end; i++) {
                        if (shown.has(i)) continue;
                        shown.add(i);
                        const prefix = i === lineIdx ? ":" : "-";
                        const num = String(i + 1).padStart(4);
                        parts.push(`  ${num}${prefix} ${lines[i]}`);
                    }
                }

                results.push(parts.join("\n"));
            } catch {
                // Skip unreadable files
            }
        }
    }
}

function filePatternToRegex(pattern: string): RegExp {
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".");
    return new RegExp(`^${escaped}$`, "i");
}
