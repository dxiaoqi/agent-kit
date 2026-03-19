// ── MCP 类型定义 ─────────────────────────────────────────────────
// 遵循 Claude Code 的 MCP 配置规范：
//   ~/.claude/mcp.json 或 .agent/mcp.json
//   { "mcpServers": { "<name>": { command, args, env } } }

// ── 服务器配置 ──────────────────────────────────────────────────

export type McpServerConfig =
    | McpStdioConfig
    | McpSseConfig
    | McpHttpConfig;

export interface McpStdioConfig {
    type?: "stdio";
    command: string;
    args?: string[];
    env?: Record<string, string>;
    /** 连接超时（ms），默认 30000 */
    timeout?: number;
}

export interface McpSseConfig {
    type: "sse";
    url: string;
    headers?: Record<string, string>;
    timeout?: number;
}

export interface McpHttpConfig {
    type: "http";
    url: string;
    headers?: Record<string, string>;
    timeout?: number;
}

// ── mcp.json 文件格式 ──────────────────────────────────────────

export interface McpConfigFile {
    mcpServers: Record<string, McpServerConfig>;
}

// ── 服务器运行状态 ──────────────────────────────────────────────

export type McpServerStatus = "disconnected" | "connecting" | "connected" | "error";

export interface McpServerState {
    name: string;
    config: McpServerConfig;
    status: McpServerStatus;
    error?: string;
    tools: McpToolDef[];
    resources: McpResourceDef[];
}

// ── MCP 工具定义（从 tools/list 返回） ─────────────────────────

export interface McpToolDef {
    name: string;
    description?: string;
    inputSchema: Record<string, unknown>;
}

// ── MCP 资源定义 ────────────────────────────────────────────────

export interface McpResourceDef {
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
}

// ── MCP 工具调用结果 ────────────────────────────────────────────

export interface McpToolResult {
    content: McpContent[];
    isError?: boolean;
}

export type McpContent =
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
    | { type: "resource"; resource: { uri: string; text?: string; blob?: string } };
