# Step 0.8 + 0.9: AgentLoop 重写 + main.ts 集成

## 改动路径

```
新建  src/kernel/agent.ts       # 新 Agent 核心循环
新建  src/kernel/events.ts      # AgentEvent discriminated union + 工厂函数
重写  src/main.ts               # 桥接新 Agent 系统
修改  src/context/message.ts    # OpenAIMessage 添加 index signature（兼容 Record<string, unknown>）
修改  src/plugin/types.ts       # ReactNode 改为临时 placeholder（Phase 1.5 引入 React）
修改  src/config/loader.ts      # env var 解析添加全局兜底（API_KEY / OPENAI_API_KEY）
修改  tsconfig.json             # 添加 "jsx": "react-jsx"（为 Phase 1.5 准备）
```

## 思路

### Step 0.8：AgentLoop 重写

核心循环从旧 `src/agent/agent.ts` 迁移到 `src/kernel/agent.ts`，主要变化：

1. **依赖注入**：Agent 构造函数接收 `LLMClient` + `ToolRegistry`，不再自己创建
2. **中性消息**：使用 `Message` 类型 + `toOpenAIMessages()` 转换
3. **真实工具执行**：通过 `ToolRegistry.execute()` 执行工具（含校验+截断）
4. **类型安全事件**：`AgentEvent` discriminated union，UI 层 switch 消费
5. **错误恢复**：使用 `classifyError()` 区分 retryable / context_overflow / fatal
6. **AbortController**：支持中断正在进行的 API 调用

### Step 0.9：main.ts 集成

`main.ts` 作为胶水层，组装新旧系统：

```
main.ts
├── loadConfig()           → 旧 config 系统（保持兼容）
├── bootstrap()
│   ├── OpenAIAdapter      → 新 provider 层
│   ├── LLMClient          → 包装适配器 + 重试
│   ├── ToolRegistry       → 空（Phase 1 注册工具）
│   ├── PluginManager      → 空（Phase 1 注册 plugin）
│   └── new Agent()        → 新核心循环
├── handleEvent()          → AgentEvent → TUI 渲染
└── runInteractive/Single  → REPL 循环
```

### 修复的 TypeScript 问题

1. **OpenAIMessage 兼容**：`toOpenAIMessages()` 返回 `OpenAIMessage[]`，但 `LLMClient.chat()` 期望 `Record<string, unknown>[]`。解决：给 `OpenAIMessage` 添加 `[key: string]: unknown` 索引签名。

2. **ReactNode 缺失**：`plugin/types.ts` import `ReactNode` from "react"，但没装 `@types/react`。解决：Phase 0 暂用 `type ReactNode = unknown` placeholder。

## 效果

### Before

```
旧 Agent 构造：new Agent(config)
  → 内部创建 Session、LLMClient、ModelRegistry
  → 工具系统是 stub
  → 事件类型 data: any
```

### After

```
新 Agent 构造：new Agent(config, llmClient, toolRegistry)
  → 依赖注入，可测试
  → ToolRegistry 真实执行工具
  → AgentEvent 每种事件类型安全
  → 错误分类恢复
```

## 验证方式

```bash
# 1. TypeScript 编译通过（零错误）
npx tsc --noEmit    # ✅ 通过

# 2. CLI 启动正常
npx tsx src/main.ts --help
# → 显示 Usage: agent [options] [command]   ✅

# 3. 运行时验证（需要有效 API Key）
# API_KEY=sk-xxx npx tsx src/main.ts ask "hello"
# → 应该看到 LLM 流式回复文本

# 4. 旧文件仍存在（渐进迁移，不破坏）
# src/agent/agent.ts   → 旧 Agent（不再被 import）
# src/client/llm_client.ts → 旧 LLMClient（不再被 import）
```

## Phase 0 完成总结

| 步骤 | 文件 | 状态 |
|------|------|------|
| 0.1 StreamEvent | `src/provider/types.ts` | ✅ |
| 0.2 Message | `src/context/message.ts` | ✅ |
| 0.3 Errors | `src/kernel/errors.ts` | ✅ |
| 0.4 Plugin | `src/plugin/types.ts` + `manager.ts` | ✅ |
| 0.5 Tool | `src/tool/types.ts` + `registry.ts` | ✅ |
| 0.6 Provider | `src/provider/adapters/openai.ts` + `client.ts` | ✅ |
| 0.7 Config | `.agent/config.toml` + `config/loader.ts` | ✅ |
| 0.8 AgentLoop | `src/kernel/agent.ts` + `events.ts` | ✅ |
| 0.9 Integration | `src/main.ts` + typecheck | ✅ |

新文件总计 **11 个**，修改 **5 个**，旧文件全部保留（渐进迁移）。
`tsc --noEmit` 零错误，CLI 正常启动。

下一步：Phase 1 — 实现内置工具（bash / read_file / write_file / search）。
