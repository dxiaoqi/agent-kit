// ── MCPManager：多服务器管理 + 工具桥接 ──────────────────────────
// 1. 从 .agent/mcp.json 加载配置
// 2. 并发连接所有 MCP 服务器
// 3. 将 MCP tools 桥接为 agent-kit ToolDef（命名：mcp__{server}__{tool}）
// 4. 提供统一的工具调用和资源读取入口

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { ToolDef, ToolResult, ToolContext } from "../tool/types.js";
import type { ToolRegistry } from "../tool/registry.js";
import type { McpConfigFile, McpServerConfig, McpServerState, McpToolDef } from "./types.js";
import { McpClient } from "./client.js";

export interface MCPManagerOptions {
    cwd: string;
    /** 自定义配置路径（默认 .agent/mcp.json） */
    configPath?: string;
    /** 连接并发度（默认 3） */
    batchSize?: number;
    /** 连接失败是否静默（默认 true） */
    silentErrors?: boolean;
}

export class MCPManager {
    private readonly clients = new Map<string, McpClient>();
    private readonly options: Required<MCPManagerOptions>;
    private config: McpConfigFile = { mcpServers: {} };

    constructor(options: MCPManagerOptions) {
        this.options = {
            configPath: options.configPath ?? join(options.cwd, ".agent", "mcp.json"),
            batchSize: options.batchSize ?? 3,
            silentErrors: options.silentErrors ?? true,
            cwd: options.cwd,
        };
    }

    // ── 加载配置 ────────────────────────────────────────────────

    loadConfig(): McpConfigFile {
        const path = this.options.configPath;
        if (!existsSync(path)) {
            this.config = { mcpServers: {} };
            return this.config;
        }

        try {
            const raw = readFileSync(path, "utf-8");
            const parsed = JSON.parse(raw);
            this.config = { mcpServers: parsed.mcpServers ?? {} };
        } catch {
            this.config = { mcpServers: {} };
        }

        return this.config;
    }

    // ── 连接所有服务器 ──────────────────────────────────────────

    async connectAll(): Promise<{ connected: string[]; failed: string[] }> {
        const entries = Object.entries(this.config.mcpServers);
        const connected: string[] = [];
        const failed: string[] = [];

        for (let i = 0; i < entries.length; i += this.options.batchSize) {
            const batch = entries.slice(i, i + this.options.batchSize);

            const results = await Promise.allSettled(
                batch.map(async ([name, config]) => {
                    const client = new McpClient(name, config);
                    await client.connect();
                    this.clients.set(name, client);
                    return name;
                }),
            );

            for (let j = 0; j < results.length; j++) {
                const result = results[j];
                const [name] = batch[j];
                if (result.status === "fulfilled") {
                    connected.push(name);
                } else {
                    failed.push(name);
                    if (!this.options.silentErrors) {
                        throw result.reason;
                    }
                }
            }
        }

        return { connected, failed };
    }

    // ── 工具桥接 ────────────────────────────────────────────────

    /**
     * 将所有已连接 MCP 服务器的工具注册到 ToolRegistry。
     * 命名约定：mcp__{serverName}__{toolName}
     */
    registerTools(registry: ToolRegistry): number {
        let count = 0;

        for (const [serverName, client] of this.clients) {
            if (client.status !== "connected") continue;

            for (const mcpTool of client.tools) {
                const bridgedName = `mcp__${serverName}__${mcpTool.name}`;
                const tool = this.bridgeTool(serverName, mcpTool, bridgedName);
                registry.register(tool);
                count++;
            }
        }

        return count;
    }

    private bridgeTool(
        serverName: string,
        mcpTool: McpToolDef,
        bridgedName: string,
    ): ToolDef {
        const client = this.clients.get(serverName)!;

        const inputSchema = z.record(z.unknown()).describe(
            mcpTool.description ?? `MCP tool: ${mcpTool.name} (server: ${serverName})`,
        );

        return {
            name: bridgedName,
            description: `[MCP: ${serverName}] ${mcpTool.description ?? mcpTool.name}\n\nInput schema: ${JSON.stringify(mcpTool.inputSchema, null, 2).slice(0, 500)}`,
            inputSchema,
            isReadOnly: false,

            async execute(input: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
                try {
                    const result = await client.callTool(mcpTool.name, input);

                    if (result.isError) {
                        const errorText = result.content
                            .filter(c => c.type === "text")
                            .map(c => (c as { text: string }).text)
                            .join("\n");
                        return { success: false, error: errorText || "MCP tool returned error" };
                    }

                    const output = result.content
                        .map(c => {
                            if (c.type === "text") return (c as { text: string }).text;
                            if (c.type === "resource") return JSON.stringify(c.resource);
                            return `[${c.type}]`;
                        })
                        .join("\n");

                    return { success: true, output: output || "(empty result)" };
                } catch (err) {
                    return {
                        success: false,
                        error: `MCP call failed: ${err instanceof Error ? err.message : String(err)}`,
                    };
                }
            },
        };
    }

    // ── 查询 ────────────────────────────────────────────────────

    getServerStates(): McpServerState[] {
        return Array.from(this.clients.values()).map(c => c.getState());
    }

    getToolList(): Array<{ server: string; tool: string; bridgedName: string }> {
        const list: Array<{ server: string; tool: string; bridgedName: string }> = [];
        for (const [serverName, client] of this.clients) {
            for (const t of client.tools) {
                list.push({
                    server: serverName,
                    tool: t.name,
                    bridgedName: `mcp__${serverName}__${t.name}`,
                });
            }
        }
        return list;
    }

    get serverCount(): number {
        return this.clients.size;
    }

    get connectedCount(): number {
        return Array.from(this.clients.values()).filter(c => c.status === "connected").length;
    }

    getSummary(): string {
        const states = this.getServerStates();
        if (states.length === 0) return "No MCP servers configured.";

        const lines = states.map(s => {
            const icon = s.status === "connected" ? "●"
                : s.status === "connecting" ? "◐"
                : s.status === "error" ? "✕"
                : "○";
            const toolCount = s.tools.length > 0 ? ` (${s.tools.length} tools)` : "";
            const err = s.error ? ` — ${s.error}` : "";
            return `  ${icon} ${s.name}: ${s.status}${toolCount}${err}`;
        });

        return `MCP Servers (${this.connectedCount}/${states.length} connected):\n${lines.join("\n")}`;
    }

    // ── 生命周期 ────────────────────────────────────────────────

    async disconnectAll(): Promise<void> {
        const disconnects = Array.from(this.clients.values()).map(c => c.disconnect());
        await Promise.allSettled(disconnects);
        this.clients.clear();
    }
}
