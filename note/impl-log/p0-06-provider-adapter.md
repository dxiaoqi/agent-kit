# Step 0.6: Provider 接口 + OpenAI 适配器拆分

## 改动路径

```
新建  src/provider/adapters/openai.ts   # 从旧 LLMClient 拆出的 OpenAI 适配器
新建  src/provider/client.ts            # 新 LLMClient：包装适配器 + 重试
保留  src/client/llm_client.ts          # 旧版，Step 0.8 后删除
保留  src/client/response.ts            # 旧版，Step 0.8 后删除
引用  src/provider/types.ts             # Step 0.1 已创建（ProviderAdapter 接口）
引用  src/kernel/errors.ts              # Step 0.3 已创建（classifyError）
```

## 思路

### 问题

旧版 `LLMClient` 直接使用 `OpenAI` SDK，三个职责混在一起：
1. SDK 实例管理（`getClient` + 客户端缓存）
2. 流式解析（chunk → StreamEvent 转换）
3. 重试逻辑（指数退避）

这导致：
- 无法支持非 OpenAI 兼容的 Provider（如 Anthropic 原生）
- 重试逻辑和流式解析耦合
- StreamEvent 使用旧的 class + 7 个 undefined

### 方案

**适配器模式**拆分为两层：

```
LLMClient（重试 + 路由）
    └── ProviderAdapter（流式解析）
            ├── OpenAIAdapter   ← 本步实现
            └── AnthropicAdapter ← Phase 2 实现
```

1. **OpenAIAdapter**：纯流式解析，实现 `ProviderAdapter.chatCompletion()`
2. **LLMClient**：包装适配器，添加重试逻辑（使用 `classifyError` 分类）

### 从旧代码迁移的关键改动

| 旧版 | 新版 | 变化 |
|------|------|------|
| `new StreamEvent(type, ...)` (7 params) | `StreamEvents.textDelta(text)` | discriminated union 工厂 |
| `new ToolCall(id, name, args)` | `{ callId, name, args }` | class → interface |
| `new TokenUsage(p, c, t, cached)` | `createTokenUsage(p, c, t, cached)` | class → factory |
| 重试在 `chatCompletion` 内 | 重试在 `LLMClient.chat` 中 | 关注点分离 |
| `err.status === 429` 硬判断 | `classifyError(err)` 分类 | 统一错误处理 |

### 新增：stream_options

OpenAI API 在流模式下默认不返回 usage。新版添加 `stream_options: { include_usage: true }` 参数，确保最后一个 chunk 包含 token 用量。

### 新增：AbortSignal 支持

适配器和 LLMClient 都支持 `AbortSignal`，用于中断正在进行的 API 调用。`sleep()` 函数也支持提前中断。

## 效果

### Before

```typescript
// 旧：LLMClient 直接硬编码 OpenAI
const client = new LLMClient();
for await (const event of client.chatCompletion(messages, tools, profile)) {
    // event 是 class StreamEvent，需要用 event.textDelta?.text
}
```

### After

```typescript
// 新：适配器可替换
const adapter = new OpenAIAdapter();
const client = new LLMClient(adapter, { maxRetries: 3 });
for await (const event of client.chat(messages, tools, profile, signal)) {
    switch (event.type) {
        case "text_delta":
            text += event.text;  // ← 直接访问，无需 ?.
            break;
        case "error":
            if (event.retryable) { /* LLMClient 已经重试过了 */ }
            break;
    }
}
```

## 验证方式

```bash
# 1. 类型检查
npx tsc --noEmit src/provider/adapters/openai.ts src/provider/client.ts

# 2. 运行时验证（Step 0.8 接入 AgentLoop 后）
# agent chat → 输入消息 → 应该能正常流式返回文本
# → 模型调用工具时应该有 tool_call_start / tool_call_delta / tool_call_complete 事件

# 3. 重试验证
# 模拟 429 → LLMClient 应该自动重试，不上报错误
# 模拟 401 → LLMClient 应该直接返回 error 事件
```
