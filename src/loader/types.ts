// ── Loader 系统类型定义 ──────────────────────────────────────────
// Loader 将不同来源/格式的资源转换为 Agent 可消费的统一文本格式。
// 类似 webpack loader：按 test 规则匹配 → 执行 load → 返回统一结果。

// ── 资源引用 ─────────────────────────────────────────────────────
// 描述一个待加载的资源，由工具或工作流构造。

export type ResourceType = "file" | "url" | "db" | "api" | "custom";

export interface ResourceRef {
    type: ResourceType;
    uri: string;
    metadata?: Record<string, unknown>;
}

// ── 加载结果 ─────────────────────────────────────────────────────

export interface LoaderResult {
    content: string;
    metadata?: Record<string, unknown>;
    /** 是否可缓存（默认 true） */
    cacheable?: boolean;
    /** 缓存 TTL（毫秒），0 表示不过期 */
    ttl?: number;
}

// ── Loader 上下文 ────────────────────────────────────────────────
// 传给 loader.load() 的运行时上下文。

export interface LoaderContext {
    cwd: string;
    abortSignal?: AbortSignal;
}

// ── Loader 定义 ──────────────────────────────────────────────────

export interface LoaderDef {
    name: string;

    /** 匹配规则：哪些资源使用这个 loader */
    test: RegExp | ((resource: ResourceRef) => boolean);

    /** 加载资源，返回统一的文本内容 */
    load(resource: ResourceRef, ctx: LoaderContext): Promise<LoaderResult>;
}
