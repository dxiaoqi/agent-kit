// ── File Loader ─────────────────────────────────────────────────
// 从文件系统加载资源。支持文本文件，大文件截断。

import { readFile, stat } from "node:fs/promises";
import { resolve, isAbsolute, extname } from "node:path";
import type { LoaderDef, ResourceRef, LoaderResult, LoaderContext } from "../types.js";

const MAX_FILE_SIZE = 512 * 1024; // 512KB

const BINARY_EXTENSIONS = new Set([
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg",
    ".woff", ".woff2", ".ttf", ".eot", ".otf",
    ".mp3", ".mp4", ".wav", ".avi", ".mov", ".webm",
    ".zip", ".gz", ".tar", ".rar", ".7z",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx",
    ".exe", ".dll", ".so", ".dylib",
    ".wasm", ".pyc", ".class",
]);

export const fileLoader: LoaderDef = {
    name: "file",

    test: (resource: ResourceRef) => resource.type === "file",

    async load(resource: ResourceRef, ctx: LoaderContext): Promise<LoaderResult> {
        const filePath = isAbsolute(resource.uri)
            ? resource.uri
            : resolve(ctx.cwd, resource.uri);

        const ext = extname(filePath).toLowerCase();
        if (BINARY_EXTENSIONS.has(ext)) {
            return {
                content: `[Binary file: ${filePath} (${ext})]`,
                metadata: { binary: true, path: filePath },
                cacheable: true,
            };
        }

        const fileStat = await stat(filePath);
        if (fileStat.size > MAX_FILE_SIZE) {
            const partial = await readPartial(filePath, MAX_FILE_SIZE);
            return {
                content: partial + `\n\n... [truncated: file is ${formatSize(fileStat.size)}, showing first ${formatSize(MAX_FILE_SIZE)}]`,
                metadata: { path: filePath, size: fileStat.size, truncated: true },
                cacheable: true,
                ttl: 30_000,
            };
        }

        const content = await readFile(filePath, "utf-8");
        return {
            content,
            metadata: { path: filePath, size: fileStat.size },
            cacheable: true,
            ttl: 30_000,
        };
    },
};

async function readPartial(filePath: string, maxBytes: number): Promise<string> {
    const { open } = await import("node:fs/promises");
    const fh = await open(filePath, "r");
    try {
        const buf = Buffer.alloc(maxBytes);
        const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
        return buf.subarray(0, bytesRead).toString("utf-8");
    } finally {
        await fh.close();
    }
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
