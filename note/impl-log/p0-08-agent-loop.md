# Step 0.8: AgentLoop 重写

## 改动路径

```
新建  src/kernel/agent.ts       # 新 Agent 类（核心循环）
新建  src/kernel/events.ts      # AgentEvent discriminated union
保留  src/agent/agent.ts        # 旧版，Step 0.9 后可删
保留  src/agent/events.ts       # 旧版，Step 0.9 后可删
保留  src/agent/session.ts      # 旧版，Step 0.9 后可删
```

## 思路

### 问题

旧版 Agent 循环：
1. 直接 import 旧 `LLMClient`、旧 `StreamEvent`、旧 `ContextManager`
2. 工具系统是 stub（`getToolSchemas() → null`）
3. 无错误恢复（所有 catch 直接终止）
4. 事件类型不清晰（`AgentEvent.data` 是 `any`）

### 方案

基于新抽象重写 Agent：

```
Agent
├── LLMClient          (Step 0.6)  → 统一调用 LLM
├── ToolRegistry       (Step 0.5)  → 工具注册 + 执行
├── Message[]          (Step 0.2)  → 中性消息格式
├── AgentEvent         (本步)      → 类型安全的事件流
└── classifyError()    (Step 0.3)  → 错误恢复
```

### 核心循环设计

```
run(input)
  ├── 添加用户消息
  ├── yield AgentStart
  └── while (shouldContinue && turnCount < maxTurns)
       └── executeTurn()
            ├── toOpenAIMessages() → 转换消息格式
            ├── llm.chat() → 流式接收
            │   ├── text_delta → yield TextDelta
            │   ├── tool_call_complete → 收集 toolCalls
            │   ├── message_complete → 记录 usage
            │   └── error → 分类 + 恢复/终止
            ├── 构建 assistant 消息 → push to messages
            ├── 如果无 toolCalls → return { hasToolCalls: false }
            └── 如果有 toolCalls：
                 ├── 逐个执行工具（校验 + 截断）
                 ├── yield ToolCallStart / ToolCallComplete / ToolCallError
                 ├── push tool_result 消息
                 └── return { hasToolCalls: true }
```

### AgentEvent 设计

使用 discriminated union + 命名空间：

| 事件类型 | 携带数据 | 触发时机 |
|---------|---------|---------|
| `agent_start` | modelId | 开始 run |
| `text_delta` | text | LLM 流式文本 |
| `text_complete` | text | 文本完成 |
| `tool_call_start` | callId, name, args | 开始执行工具 |
| `tool_call_complete` | callId, name, result | 工具执行成功 |
| `tool_call_error` | callId, name, error | 工具执行失败 |
| `context_compact` | summary, tokensBefore/After | 上下文压缩（Phase 2） |
| `agent_end` | turnCount, usage, cost | 循环结束 |
| `agent_error` | error, retryable | 错误 |

### 与旧版的差异

| 方面 | 旧版 | 新版 |
|------|------|------|
| 工具 | stub | ToolRegistry.execute()（校验+截断） |
| 消息 | OpenAI 格式硬编码 | Message 中性格式 + toOpenAIMessages() |
| 事件 | AgentEvent class (data: any) | AgentEvent discriminated union |
| 错误 | catch → terminate | classifyError → retryable/overflow/fatal |
| LLM | 直接 new LLMClient | 注入 LLMClient（可替换适配器） |
| 中断 | 无 | AbortController |

## 效果

### Before

```typescript
// 旧：无工具、无恢复、无类型安全
const agent = new Agent(session);
for await (const event of agent.run("read /tmp/foo")) {
    if (event.type === "text") console.log(event.data);  // ← any
    // 工具调用？不存在
}
```

### After

```typescript
// 新：完整工具循环、类型安全事件
const agent = new Agent(config, llmClient, toolRegistry);
for await (const event of agent.run("read /tmp/foo and summarize")) {
    switch (event.type) {
        case "text_delta":
            process.stdout.write(event.text);  // ← 类型确定
            break;
        case "tool_call_start":
            console.log(`⏺ ${event.name}(${JSON.stringify(event.args)})`);
            break;
        case "tool_call_complete":
            console.log(`✓ ${event.name}: ${event.result.output?.slice(0, 100)}`);
            break;
    }
}
```

## 验证方式

```bash
# 1. 类型检查
npx tsc --noEmit src/kernel/agent.ts src/kernel/events.ts

# 2. 集成验证（Step 0.9 中 main.ts 适配后）
# node dist/main.js chat → 输入问题
# → 应该看到 text_delta 流式输出
# → 如果模型调用工具，应看到 tool_call_start / tool_call_complete

# 3. 错误恢复验证
# 设置错误 apiKey → 应看到 agent_error { error: "...", retryable: false }
# 设置错误 baseUrl → 应看到重试后 agent_error
```
