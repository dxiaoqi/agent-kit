// ── MCP 客户端 ───────────────────────────────────────────────────
// 管理与单个 MCP 服务器的连接。
// 实现 JSON-RPC 协议：initialize → tools/list → tools/call。

import type {
    McpServerConfig,
    McpServerState,
    McpServerStatus,
    McpToolDef,
    McpResourceDef,
    McpToolResult,
} from "./types.js";
import {
    StdioTransport,
    HttpTransport,
    type McpTransport,
    type JsonRpcRequest,
} from "./transport.js";

export class McpClient {
    private transport: McpTransport | null = null;
    private state: McpServerState;
    private nextId = 1;

    constructor(
        private readonly name: string,
        private readonly config: McpServerConfig,
    ) {
        this.state = {
            name,
            config,
            status: "disconnected",
            tools: [],
            resources: [],
        };
    }

    async connect(): Promise<void> {
        this.setStatus("connecting");

        try {
            this.transport = this.createTransport();

            if (this.transport instanceof StdioTransport) {
                await this.transport.connect();
            }

            await this.initialize();
            await this.discoverTools();
            await this.discoverResources();

            this.setStatus("connected");
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.state.error = msg;
            this.setStatus("error");
            throw err;
        }
    }

    private createTransport(): McpTransport {
        const type = this.config.type ?? "stdio";
        const timeout = this.config.timeout ?? 30_000;

        switch (type) {
            case "stdio": {
                const cfg = this.config as { command: string; args?: string[]; env?: Record<string, string> };
                return new StdioTransport(cfg.command, cfg.args ?? [], cfg.env, timeout);
            }
            case "sse":
            case "http": {
                const cfg = this.config as { url: string; headers?: Record<string, string> };
                return new HttpTransport(cfg.url, cfg.headers, timeout);
            }
            default:
                throw new Error(`Unsupported MCP transport type: ${type}`);
        }
    }

    private async initialize(): Promise<void> {
        await this.request("initialize", {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "agent-kit", version: "0.1.0" },
        });

        await this.notify("notifications/initialized", {});
    }

    private async discoverTools(): Promise<void> {
        const res = await this.request("tools/list", {});
        if (res && typeof res === "object" && "tools" in (res as object)) {
            this.state.tools = ((res as any).tools ?? []).map((t: any) => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema ?? {},
            }));
        }
    }

    private async discoverResources(): Promise<void> {
        try {
            const res = await this.request("resources/list", {});
            if (res && typeof res === "object" && "resources" in (res as object)) {
                this.state.resources = ((res as any).resources ?? []).map((r: any) => ({
                    uri: r.uri,
                    name: r.name,
                    description: r.description,
                    mimeType: r.mimeType,
                }));
            }
        } catch {
            // resources/list is optional
        }
    }

    async callTool(toolName: string, args: Record<string, unknown>): Promise<McpToolResult> {
        if (this.state.status !== "connected") {
            throw new Error(`MCP server "${this.name}" is not connected`);
        }

        const res = await this.request("tools/call", { name: toolName, arguments: args });
        return (res as McpToolResult) ?? { content: [{ type: "text", text: "(empty response)" }] };
    }

    async readResource(uri: string): Promise<string> {
        if (this.state.status !== "connected") {
            throw new Error(`MCP server "${this.name}" is not connected`);
        }

        const res = await this.request("resources/read", { uri });
        const contents = (res as any)?.contents;
        if (Array.isArray(contents) && contents.length > 0) {
            return contents[0].text ?? JSON.stringify(contents[0]);
        }
        return JSON.stringify(res);
    }

    // ── JSON-RPC helpers ────────────────────────────────────────

    private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
        if (!this.transport) throw new Error("Transport not initialized");

        const req: JsonRpcRequest = {
            jsonrpc: "2.0",
            id: this.nextId++,
            method,
            params,
        };

        const res = await this.transport.send(req);
        if (res.error) {
            throw new Error(`MCP error [${res.error.code}]: ${res.error.message}`);
        }
        return res.result;
    }

    private async notify(method: string, params: Record<string, unknown>): Promise<void> {
        if (!this.transport) return;

        const line = JSON.stringify({ jsonrpc: "2.0", method, params });
        // For notifications, we use the transport's send but ignore the response
        // Since notifications don't have an id, we need to write directly
        // For stdio, this works via the stdin pipe
        try {
            await this.transport.send({
                jsonrpc: "2.0",
                id: this.nextId++,
                method,
                params,
            });
        } catch {
            // notifications can be fire-and-forget
        }
    }

    // ── State ───────────────────────────────────────────────────

    getState(): McpServerState {
        return { ...this.state };
    }

    get tools(): McpToolDef[] {
        return this.state.tools;
    }

    get resources(): McpResourceDef[] {
        return this.state.resources;
    }

    get status(): McpServerStatus {
        return this.state.status;
    }

    private setStatus(status: McpServerStatus): void {
        this.state.status = status;
    }

    async disconnect(): Promise<void> {
        try {
            await this.transport?.close();
        } catch {
            // ignore close errors
        }
        this.transport = null;
        this.setStatus("disconnected");
    }
}
