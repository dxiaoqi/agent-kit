// ── MCP 传输层 ───────────────────────────────────────────────────
// 抽象 JSON-RPC 传输：stdio（子进程）和 SSE/HTTP（远程）。
// Agent-kit 使用纯 Node.js 实现，不依赖 @modelcontextprotocol/sdk。

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

// ── JSON-RPC 2.0 ───────────────────────────────────────────────

export interface JsonRpcRequest {
    jsonrpc: "2.0";
    id: number;
    method: string;
    params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
    jsonrpc: "2.0";
    id: number;
    result?: unknown;
    error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
    jsonrpc: "2.0";
    method: string;
    params?: Record<string, unknown>;
}

// ── Transport 接口 ──────────────────────────────────────────────

export interface McpTransport {
    send(request: JsonRpcRequest): Promise<JsonRpcResponse>;
    onNotification?(handler: (notification: JsonRpcNotification) => void): void;
    close(): Promise<void>;
}

// ── Stdio Transport ─────────────────────────────────────────────

export class StdioTransport implements McpTransport {
    private process: ChildProcess | null = null;
    private reader: Interface | null = null;
    private nextId = 1;
    private pending = new Map<number, {
        resolve: (res: JsonRpcResponse) => void;
        reject: (err: Error) => void;
        timer: ReturnType<typeof setTimeout>;
    }>();
    private notificationHandler?: (n: JsonRpcNotification) => void;

    constructor(
        private readonly command: string,
        private readonly args: string[] = [],
        private readonly env?: Record<string, string>,
        private readonly timeoutMs = 30_000,
    ) {}

    async connect(): Promise<void> {
        const mergedEnv = { ...process.env, ...this.env };

        this.process = spawn(this.command, this.args, {
            stdio: ["pipe", "pipe", "pipe"],
            env: mergedEnv,
        });

        if (!this.process.stdout || !this.process.stdin) {
            throw new Error(`Failed to spawn MCP server: ${this.command}`);
        }

        this.reader = createInterface({ input: this.process.stdout });

        this.reader.on("line", (line) => {
            try {
                const msg = JSON.parse(line);
                if ("id" in msg && this.pending.has(msg.id)) {
                    const p = this.pending.get(msg.id)!;
                    clearTimeout(p.timer);
                    this.pending.delete(msg.id);
                    p.resolve(msg as JsonRpcResponse);
                } else if ("method" in msg && !("id" in msg)) {
                    this.notificationHandler?.(msg as JsonRpcNotification);
                }
            } catch {
                // ignore malformed lines
            }
        });

        this.process.on("error", (err) => {
            for (const [, p] of this.pending) {
                clearTimeout(p.timer);
                p.reject(err);
            }
            this.pending.clear();
        });

        this.process.on("exit", () => {
            for (const [, p] of this.pending) {
                clearTimeout(p.timer);
                p.reject(new Error("MCP server process exited"));
            }
            this.pending.clear();
        });
    }

    async send(request: JsonRpcRequest): Promise<JsonRpcResponse> {
        if (!this.process?.stdin?.writable) {
            throw new Error("MCP transport not connected");
        }

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(request.id);
                reject(new Error(`MCP request timed out: ${request.method}`));
            }, this.timeoutMs);

            this.pending.set(request.id, { resolve, reject, timer });

            const line = JSON.stringify(request) + "\n";
            this.process!.stdin!.write(line);
        });
    }

    onNotification(handler: (n: JsonRpcNotification) => void): void {
        this.notificationHandler = handler;
    }

    async close(): Promise<void> {
        for (const [, p] of this.pending) {
            clearTimeout(p.timer);
            p.reject(new Error("Transport closing"));
        }
        this.pending.clear();
        this.reader?.close();
        this.process?.kill();
        this.process = null;
    }
}

// ── HTTP/SSE Transport ──────────────────────────────────────────

export class HttpTransport implements McpTransport {
    private notificationHandler?: (n: JsonRpcNotification) => void;

    constructor(
        private readonly url: string,
        private readonly headers?: Record<string, string>,
        private readonly timeoutMs = 30_000,
    ) {}

    async send(request: JsonRpcRequest): Promise<JsonRpcResponse> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            const res = await fetch(this.url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...this.headers,
                },
                body: JSON.stringify(request),
                signal: controller.signal,
            });

            if (!res.ok) {
                throw new Error(`MCP HTTP error: ${res.status} ${res.statusText}`);
            }

            return await res.json() as JsonRpcResponse;
        } finally {
            clearTimeout(timer);
        }
    }

    onNotification(handler: (n: JsonRpcNotification) => void): void {
        this.notificationHandler = handler;
    }

    async close(): Promise<void> {
        // stateless — nothing to close
    }
}
