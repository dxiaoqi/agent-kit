// ── 错误分类体系 ─────────────────────────────────────────────────
// Agent 循环根据错误类别决定恢复策略：
//   retryable   → 指数退避重试（rate limit / 网络抖动）
//   context_overflow → 触发 auto_compact 后重试
//   fatal       → 终止循环，上报用户

export type ErrorCategory = "retryable" | "context_overflow" | "fatal";

export class AgentError extends Error {
    constructor(
        message: string,
        public readonly category: ErrorCategory,
        public readonly retryAfterMs?: number,
        public readonly cause?: unknown,
    ) {
        super(message);
        this.name = "AgentError";
    }

    get isRetryable(): boolean {
        return this.category === "retryable";
    }

    get isContextOverflow(): boolean {
        return this.category === "context_overflow";
    }
}

export class ConfigError extends Error {
    constructor(
        message: string,
        public readonly context?: Record<string, unknown>,
    ) {
        super(message);
        this.name = "ConfigError";
    }
}

export class ToolExecutionError extends Error {
    constructor(
        message: string,
        public readonly toolName: string,
        public readonly cause?: unknown,
    ) {
        super(message);
        this.name = "ToolExecutionError";
    }
}

export class PermissionDeniedError extends Error {
    constructor(
        public readonly toolName: string,
        public readonly reason: string,
    ) {
        super(`Permission denied for tool "${toolName}": ${reason}`);
        this.name = "PermissionDeniedError";
    }
}

// ── 错误分类器 ───────────────────────────────────────────────────
// 将原始 API 错误转换为分类错误，供 Agent 循环使用。

export function classifyError(err: unknown): AgentError {
    if (err instanceof AgentError) return err;

    const message = err instanceof Error ? err.message : String(err);
    const status = (err as any)?.status as number | undefined;
    const type = (err as any)?.type as string | undefined;

    // Rate limit
    if (status === 429) {
        const retryAfter = parseRetryAfter(err);
        return new AgentError(
            `Rate limited: ${message}`,
            "retryable",
            retryAfter,
            err,
        );
    }

    // Context overflow
    if (
        status === 400 &&
        /context.*(length|window|limit|too long|maximum)/i.test(message)
    ) {
        return new AgentError(
            `Context overflow: ${message}`,
            "context_overflow",
            undefined,
            err,
        );
    }

    // Connection / network errors
    if (
        type === "connection_error" ||
        status === 502 || status === 503 || status === 504 ||
        /ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed/i.test(message)
    ) {
        return new AgentError(
            `Network error: ${message}`,
            "retryable",
            undefined,
            err,
        );
    }

    // Server errors (500)
    if (status === 500) {
        return new AgentError(
            `Server error: ${message}`,
            "retryable",
            undefined,
            err,
        );
    }

    // Everything else is fatal
    return new AgentError(message, "fatal", undefined, err);
}

function parseRetryAfter(err: unknown): number | undefined {
    const headers = (err as any)?.headers;
    if (!headers) return undefined;

    const retryAfter = headers["retry-after"] ?? headers.get?.("retry-after");
    if (!retryAfter) return undefined;

    const seconds = Number(retryAfter);
    if (!Number.isNaN(seconds)) return seconds * 1000;

    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());

    return undefined;
}
