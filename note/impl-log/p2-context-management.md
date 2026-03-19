# Phase 2：上下文管理系统

> 实现日期：2026-03-14  
> 状态：✅ typecheck 通过（零错误）

---

## 一、设计思路

### 核心矛盾

上下文窗口有限（通常 128k token），但长会话中消息会无限增长。一次 `read_file` 可能消耗 4000+ token，10 轮工具调用后上下文就可能接近耗尽。

### 三层压缩 + 热度追踪 + 持久化

参考 Claude Code 和 Kode-Agent 的实践，设计了以下分层架构：

```
用户输入 → addUserMessage
                │
    ┌───────────v────────────┐
    │   ContextManager       │  ← 统一入口
    │   ┌─ TokenTracker ───┐ │     token 计数 + 阈值检查
    │   ├─ micro_compact ──┤ │     Layer 1: 静默裁剪旧 tool_result
    │   ├─ auto_compact ───┤ │     Layer 2: LLM 摘要替换全部消息
    │   ├─ FileFreshness ──┤ │     文件热度追踪（回温依据）
    │   └─ Transcript ─────┘ │     JSONL 持久化（信息不丢失）
    └────────────────────────┘
                │
    prepareForLLMCall() → OpenAIMessage[]
```

### 阈值设定

| 阈值 | 百分比 | 作用 |
|------|--------|------|
| micro_compact | 60% | 开始替换旧 tool_result 为占位符 |
| auto_compact  | 80% | 保存完整对话，LLM 生成摘要替换 |
| compact_target | 40% | 压缩后目标 token 量 |

---

## 二、新增文件

### 2.1 `src/context/token.ts` — Token 计数

- `estimateTokens(text)`: 简易估算（字符数 / 4）
- `estimateMessageTokens(msg)`: 按 ContentBlock 类型分别估算
- `TokenTracker`: 管理阈值和当前 token 数，提供 `needsMicroCompact` / `needsAutoCompact` 布尔值

**设计决策**：默认使用字符估算而非 tiktoken，原因：
1. tiktoken 需要加载 BPE 词表（~4MB），启动延迟
2. 精确度对于压缩决策不关键（10-20% 偏差可接受）
3. 可通过替换 `estimateTokens` 升级为精确计数

### 2.2 `src/context/compact.ts` — 两层压缩

**Layer 1: `microCompact(messages)`**
- 保留最近 3 个 tool_result 不动
- 将更早的 tool_result（>200 字符）替换为占位符
- 占位符包含工具名和节省的 token 数
- 不改变消息数组长度，对 LLM 透明

**Layer 2: `autoCompact(messages, summarizer)`**
- 调用 `CompactSummarizer.summarize()` 生成摘要
- 替换全部消息为 `[user: Context compressed + summary]` + `[assistant: Understood]`
- 调用方（ContextManager）负责在压缩前持久化完整对话

**Layer 3: `manualCompact`**
- 与 auto_compact 相同逻辑，但无阈值检查
- 供 `/compact` 命令或 Agent 主动触发

### 2.3 `src/context/freshness.ts` — 文件热度追踪

- `trackRead(path)` / `trackWrite(path)`: Agent 读写文件时调用
- `rankByFreshness()`: 按热度排序
- 评分规则：写过 +100, 最近 1 分钟 +50, 时间衰减, 读写次数加成
- 用途：auto_compact 后可回温最重要的文件（Phase 3 扩展）

### 2.4 `src/context/transcript.ts` — JSONL 持久化

- 每条消息以 `{timestamp, type, data}` 追加写入
- 支持 `message` / `compact` / `session_start` / `session_end` 类型
- 使用 `WriteStream` 追加写入，不阻塞主循环
- 提供 `readTranscript()` 工具函数供调试/恢复

### 2.5 `src/context/summarizer.ts` — LLM 摘要器

- 实现 `CompactSummarizer` 接口
- 构建专用 system prompt 指导 LLM 生成结构化摘要
- 使用现有 `LLMClient` 调用，复用配置和重试逻辑

### 2.6 `src/context/manager.ts` — ContextManager（重写）

**对外接口**：
```typescript
// 消息操作
addUserMessage(content: string): void
addAssistantMessage(text: string, toolUses?: ContentBlock.ToolUse[]): void
addToolResult(toolCallId: string, output: string, isError?: boolean): void
updateSystemPrompt(prompt: string): void

// 文件热度
trackFileRead(filePath: string): void
trackFileWrite(filePath: string): void

// 压缩
runMicroCompact(): boolean
runAutoCompact(summarizer: CompactSummarizer): Promise<CompactResult | null>
forceCompact(summarizer: CompactSummarizer): Promise<CompactResult>

// LLM 调用准备
prepareForLLMCall(): OpenAIMessage[]

// 状态
tokenCount, utilizationPercent, needsAutoCompact, messageCount, compacts
```

**关键设计**：
- Agent 不再直接持有 `Message[]`，而是通过 ContextManager 操作
- `prepareForLLMCall()` 自动执行 micro_compact + 注入 system prompt
- 每条消息同时写入 transcript（如果启用）

---

## 三、修改文件

### 3.1 `src/kernel/agent.ts` — Agent Loop 接入

- 删除 `private readonly messages: Message[]`，改用 `private readonly ctx: ContextManager`
- 新增 `private readonly summarizer: LLMSummarizer`
- `executeTurn()` 中用 `ctx.prepareForLLMCall()` 替代 `toOpenAIMessages(this.messages)`
- 工具执行后调用 `ctx.addToolResult()` 和 `trackFileAccess()`
- 新增 `checkAndCompact()` 在每轮开始时检查并执行压缩
- 上下文溢出错误触发 `ctx.forceCompact()` 后重试
- 新增 `compact()` public 方法供 `/compact` 命令使用
- 新增 `getContextStats()` 暴露上下文统计
- 新增 `close()` 方法关闭 transcript

### 3.2 `src/kernel/events.ts` — 新增事件

- 新增 `AgentEvents.contextCompact()` 工厂函数

### 3.3 `src/main.ts` — 入口适配

- `runInteractive()` / `runSingle()` 新增 `agent.close()` 调用
- `handlePlainEvent()` 新增 `context_compact` 事件处理

### 3.4 `src/ui/hooks/use-agent.ts` — UI 事件处理

- 新增 `context_compact` 事件 → 显示为 system 消息

### 3.5 `src/ui/screens/REPL.tsx` — 新增命令

- `/compact`: 强制触发上下文压缩
- `/status`: 显示上下文 token 使用率、消息数、压缩次数、追踪文件数

### 3.6 清理遗留文件

删除 `src/agent/` 目录（旧版 Agent、Session、Events），已被 `src/kernel/` 完全替代：
- `src/agent/agent.ts`
- `src/agent/session.ts`
- `src/agent/events.ts`
- `src/ui/tui.ts`（旧版 readline TUI，已被 Ink UI 替代）

---

## 四、数据流全景

```
用户输入 "读取 config.toml"
    │
    v
Agent.run(input)
    │
    ├→ ctx.addUserMessage(input)          // 存储 + 持久化
    ├→ ctx.checkAndCompact()              // token 检查 → 可能触发压缩
    │   ├→ ctx.runMicroCompact()          // Layer 1: 替换旧 tool_result
    │   └→ ctx.runAutoCompact(summarizer) // Layer 2: LLM 摘要（如果仍超阈值）
    │       ├→ transcript.logMessages()   // 持久化完整对话
    │       └→ summarizer.summarize()     // LLM 生成摘要
    │
    ├→ ctx.prepareForLLMCall()            // 注入 system prompt → OpenAIMessage[]
    │   └→ 内部自动 microCompact
    │
    ├→ llm.chat(messages, tools, ...)     // 调用 LLM
    │
    ├→ ctx.addAssistantMessage(text, toolUses)  // 存储 assistant 响应
    │
    └→ tools.execute(call)                // 执行工具
        ├→ ctx.addToolResult(callId, output)    // 存储工具结果
        └→ ctx.trackFileRead("config.toml")     // 追踪文件热度
```

---

## 五、验证方式

```bash
# 1. TypeScript 类型检查
npx tsc --noEmit  # ✅ 零错误

# 2. 运行时验证
npx tsx src/main.ts chat
# → 输入 /status 查看上下文统计
# → 输入 /compact 触发手动压缩
# → 长会话后观察自动压缩事件

# 3. 检查 transcript 日志
ls .agent/transcripts/  # 应有 session-*.jsonl 文件
```

---

## 六、扩展路线

| 方向 | 说明 |
|------|------|
| tiktoken 精确计数 | 替换 `estimateTokens` 函数 |
| 文件回温 | compact 后自动读取热门文件补回上下文 |
| Prompt Cache | system prompt 添加 `cache_control` 字段（L0 层） |
| ANR 检测 | 监控 LLM 调用耗时，超时主动 compact |
| Token 预算可视化 | StatusBar 显示实时 token 使用率 |
