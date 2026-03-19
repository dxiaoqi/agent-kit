// ── LoaderPipeline ───────────────────────────────────────────────
// 资源加载管道：注册 loader → 按 test 规则匹配 → 执行 load。
// 支持简单的内存缓存（按 uri 键，尊重 TTL）。

import type { LoaderDef, ResourceRef, LoaderResult, LoaderContext } from "./types.js";

interface CacheEntry {
    result: LoaderResult;
    expiresAt: number;
}

export class LoaderPipeline {
    private readonly loaders: LoaderDef[] = [];
    private readonly cache = new Map<string, CacheEntry>();
    private readonly ctx: LoaderContext;

    constructor(ctx: LoaderContext) {
        this.ctx = ctx;
    }

    register(loader: LoaderDef): void {
        this.loaders.push(loader);
    }

    async load(resource: ResourceRef): Promise<LoaderResult> {
        const cacheKey = `${resource.type}:${resource.uri}`;
        const cached = this.cache.get(cacheKey);
        if (cached && (cached.expiresAt === 0 || cached.expiresAt > Date.now())) {
            return cached.result;
        }

        const loader = this.findLoader(resource);
        if (!loader) {
            throw new Error(`No loader found for resource: ${resource.type}:${resource.uri}`);
        }

        const result = await loader.load(resource, this.ctx);

        if (result.cacheable !== false) {
            const ttl = result.ttl ?? 0;
            this.cache.set(cacheKey, {
                result,
                expiresAt: ttl > 0 ? Date.now() + ttl : 0,
            });
        }

        return result;
    }

    private findLoader(resource: ResourceRef): LoaderDef | undefined {
        return this.loaders.find(l => {
            if (typeof l.test === "function") return l.test(resource);
            return l.test.test(resource.uri);
        });
    }

    listLoaders(): string[] {
        return this.loaders.map(l => l.name);
    }

    clearCache(): void {
        this.cache.clear();
    }
}
