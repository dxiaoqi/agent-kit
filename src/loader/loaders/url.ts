// ── URL Loader ──────────────────────────────────────────────────
// 从 HTTP(S) URL 加载资源。返回纯文本或简化的 HTML 内容。

import type { LoaderDef, ResourceRef, LoaderResult, LoaderContext } from "../types.js";

const MAX_RESPONSE_SIZE = 256 * 1024; // 256KB

export const urlLoader: LoaderDef = {
    name: "url",

    test: (resource: ResourceRef) =>
        resource.type === "url" || /^https?:\/\//.test(resource.uri),

    async load(resource: ResourceRef, ctx: LoaderContext): Promise<LoaderResult> {
        const url = resource.uri;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);

        if (ctx.abortSignal) {
            ctx.abortSignal.addEventListener("abort", () => controller.abort(), { once: true });
        }

        try {
            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    "User-Agent": "agent-kit/0.1 (Loader)",
                    "Accept": "text/html,text/plain,application/json,*/*",
                },
            });

            if (!response.ok) {
                return {
                    content: `[HTTP ${response.status} ${response.statusText}] Failed to fetch: ${url}`,
                    metadata: { url, status: response.status },
                    cacheable: false,
                };
            }

            const contentType = response.headers.get("content-type") ?? "";
            const isText = /text|json|xml|javascript|css|svg/.test(contentType);

            if (!isText) {
                return {
                    content: `[Binary content: ${contentType}] ${url}`,
                    metadata: { url, contentType, binary: true },
                    cacheable: true,
                    ttl: 60_000,
                };
            }

            let body = await response.text();

            if (body.length > MAX_RESPONSE_SIZE) {
                body = body.slice(0, MAX_RESPONSE_SIZE)
                    + `\n\n... [truncated: response was ${formatSize(body.length)}]`;
            }

            if (contentType.includes("html")) {
                body = stripHtml(body);
            }

            return {
                content: body,
                metadata: { url, contentType, size: body.length },
                cacheable: true,
                ttl: 60_000,
            };
        } catch (err: any) {
            if (err.name === "AbortError") {
                return {
                    content: `[Timeout] Failed to fetch ${url} within 15s`,
                    metadata: { url, error: "timeout" },
                    cacheable: false,
                };
            }
            return {
                content: `[Error] Failed to fetch ${url}: ${err.message}`,
                metadata: { url, error: err.message },
                cacheable: false,
            };
        } finally {
            clearTimeout(timeout);
        }
    },
};

function stripHtml(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<nav[\s\S]*?<\/nav>/gi, "")
        .replace(/<footer[\s\S]*?<\/footer>/gi, "")
        .replace(/<header[\s\S]*?<\/header>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
