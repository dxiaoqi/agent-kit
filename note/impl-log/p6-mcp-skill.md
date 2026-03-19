# Phase 6：MCP + Skill 系统实现日志

## 一、设计目标

遵循 Claude Code 的配置和使用方式，实现：

1. **MCP (Model Context Protocol)**——连接外部工具服务器，动态扩展 Agent 能力
2. **Skill 系统**——两层按需加载的指令集，避免 system prompt 膨胀

## 二、架构概览

### MCP 架构

```
.agent/mcp.json                     Agent-Kit
┌─────────────────┐        ┌────────────────────────────┐
│ {                │        │                            │
│   "mcpServers": {│───────▶│  MCPManager                │
│     "fs": {      │        │    ├── loadConfig()        │
│       "command":  │        │    ├── connectAll()        │
│       "python3", │        │    └── registerTools()     │
│       "args":[...│        │         │                  │
│     }            │        │         ▼                  │
│   }              │        │  ┌─────────────────┐       │
│ }                │        │  │ McpClient ×N    │       │
└─────────────────┘        │  │  ├── connect()   │       │
                           │  │  ├── tools/list  │       │
                           │  │  └── tools/call  │       │
                           │  └────────┬────────┘       │
                           │           │                 │
                           │   StdioTransport            │
                           │   HttpTransport             │
                           │           │                 │
                           │           ▼                 │
                           │  ToolRegistry               │
                           │  mcp__fs__read_file         │
                           │  mcp__fs__write_file        │
                           │  mcp__db__query             │
                           └────────────────────────────┘
```

### Skill 架构

```
.agent/skills/                   Agent-Kit
├── code-review/
│   └── SKILL.md          ┌────────────────────────┐
├── pdf/                   │                        │
│   └── SKILL.md    ──────▶│  SkillLoader           │
└── ...                    │    ├── scanAll()       │
                           │    ├── getDescriptions()│──▶ system prompt
                           │    └── getContent()    │    (Layer 1: ~100 tokens/skill)
                           │         │              │
                           │         ▼              │
                           │  load_skill 工具       │
                           │  (Layer 2: 完整 body)  │──▶ tool_result
                           └────────────────────────┘
```

## 三、文件清单

### MCP 模块

| 文件 | 职责 |
|------|------|
| `src/mcp/types.ts` | MCP 配置类型、服务器状态、工具/资源定义、调用结果 |
| `src/mcp/transport.ts` | JSON-RPC 2.0 传输层：StdioTransport（子进程）+ HttpTransport（HTTP POST） |
| `src/mcp/client.ts` | MCP 客户端：initialize → tools/list → tools/call |
| `src/mcp/manager.ts` | MCPManager：多服务器管理、并发连接、工具桥接到 ToolRegistry |
| `src/mcp/index.ts` | 汇总导出 |

### Skill 模块

| 文件 | 职责 |
|------|------|
| `src/skill/loader.ts` | SkillLoader：SKILL.md 扫描 + YAML frontmatter 解析 + 两层注入 |
| `src/skill/tool.ts` | `load_skill` 工具：按名称加载完整 skill body |
| `src/skill/index.ts` | 汇总导出 |

### 配置和集成

| 文件 | 变更 |
|------|------|
| `.agent/mcp.json` | MCP 服务器配置（遵循 Claude Code 格式） |
| `.agent/skills/code-review/SKILL.md` | 示例 skill |
| `.agent/config.toml` | 新增 `skillDirs` 配置 |
| `src/config/config.ts` | 新增 `skillDirs` schema |
| `src/main.ts` | Bootstrap 集成 MCP + Skill |
| `src/ui/screens/REPL.tsx` | 新增 `/tools` 命令 |

## 四、MCP 详细设计

### 4.1 配置格式（遵循 Claude Code）

```json
// .agent/mcp.json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"],
      "env": { "ALLOWED_DIR": "/home/user" }
    },
    "database": {
      "type": "sse",
      "url": "http://localhost:3001/mcp",
      "headers": { "Authorization": "Bearer xxx" }
    }
  }
}
```

### 4.2 传输层

| 传输类型 | 实现 | 适用场景 |
|---------|------|---------|
| `stdio`（默认） | `StdioTransport` — spawn 子进程，通过 stdin/stdout JSON-RPC | 本地 MCP 服务器 |
| `sse` / `http` | `HttpTransport` — HTTP POST JSON-RPC | 远程 MCP 服务器 |

纯 Node.js 实现，不依赖 `@modelcontextprotocol/sdk`。

### 4.3 工具桥接

MCP 工具注册到 ToolRegistry 时使用命名约定：

```
mcp__{serverName}__{toolName}
```

例如 `mcp__filesystem__read_file`。这使得：
- 权限系统可以按前缀匹配 MCP 工具
- 工作流可以按工具名白名单/黑名单
- UI 可以识别并特殊渲染 MCP 工具

### 4.4 连接流程

```
MCPManager.connectAll()
  ├── 并发连接（batch size = 3）
  │    └── McpClient.connect()
  │         ├── createTransport(config)
  │         ├── initialize() — JSON-RPC "initialize"
  │         ├── discoverTools() — JSON-RPC "tools/list"
  │         └── discoverResources() — JSON-RPC "resources/list"（可选）
  └── registerTools(registry)
       └── 为每个 MCP tool 创建 ToolDef 桥接
```

### 4.5 MCP 工具执行

```
Agent 调用 mcp__fs__read → ToolRegistry.execute()
  → bridgedTool.execute() → McpClient.callTool("read", args)
    → transport.send(JSON-RPC "tools/call")
      → MCP Server 执行
      ← JSON-RPC response
    ← McpToolResult { content: [...] }
  → ToolResult { success, output }
```

## 五、Skill 详细设计

### 5.1 两层注入

**Layer 1：System Prompt（元数据）**

```
Available skills (use load_skill tool to activate):
  - code-review: Perform thorough code reviews... [review,quality]
  - pdf: Process PDF files with OCR support
```

每个 skill 仅 ~100 tokens，不膨胀 system prompt。

**Layer 2：Tool Result（完整内容）**

Agent 调用 `load_skill("code-review")` 时，完整 SKILL.md body 注入到 tool_result：

```xml
<skill name="code-review">
# Code Review Skill
## Review Checklist
### 1. Security
...
</skill>
```

### 5.2 SKILL.md 格式

```markdown
---
name: code-review
description: Perform thorough code reviews with security analysis.
tags: review,quality
---

# Code Review Skill

Full instructions here...
```

- `---` 分隔的 YAML frontmatter
- `name`：skill 名称（必填，默认用目录名）
- `description`：简短描述（Layer 1 展示）
- `tags`：可选标签
- body：完整指令（Layer 2 加载）

### 5.3 目录扫描

默认扫描 `.agent/skills/`，支持配置多个目录：

```toml
skillDirs = [".agent/skills", "~/.agent-kit/skills"]
```

两种目录结构均支持：
```
skills/
  code-review/SKILL.md     ← 子目录模式
  SKILL.md                 ← 直接在 skills/ 下
```

## 六、验证

```
$ npx tsc --noEmit    # ✓ 零错误
```

## 七、设计决策

1. **纯 Node.js MCP 客户端**：不依赖 `@modelcontextprotocol/sdk`，自行实现 JSON-RPC over stdio/HTTP，减少依赖
2. **命名约定 `mcp__server__tool`**：双下划线分隔，避免与内置工具命名冲突，便于权限系统匹配
3. **Skill 延迟加载**：system prompt 只放元数据（Layer 1），完整内容通过 `load_skill` 按需加载（Layer 2），节省上下文空间
4. **MCP 静默失败**：单个 MCP 服务器连接失败不影响其他服务器和主 Agent 启动
5. **配置兼容 Claude Code**：`.agent/mcp.json` 格式完全兼容 `~/.claude/mcp.json`，用户可以直接复制配置
