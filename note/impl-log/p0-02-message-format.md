# Step 0.2: 内部中性消息格式

## 改动路径

```
新建  src/context/message.ts
保留  src/context/manager.ts （旧版，Step 0.8 重写）
```

## 思路

### 问题

旧版 `ContextManager` 的消息格式直接使用 OpenAI 的 `tool_calls` / `tool_call_id` 结构：

```typescript
// 旧 src/context/manager.ts
interface MessageItem {
    role: "user" | "assistant" | "tool";
    content: string | null;
    toolCalls?: ToolCallInfo[];   // ← OpenAI 特有结构
    toolCallId?: string;          // ← OpenAI 特有字段
}
```

这意味着：
1. 如果要支持 Anthropic，需要在 ContextManager 里做格式转换——职责不对
2. 无法表达 Anthropic 的 `thinking` 块、`cache_control` 标记
3. 消息格式和 SDK 绑死，Plugin 开发者需要了解 OpenAI 的内部结构

### 方案

定义一个**中性超集格式**，能表达 OpenAI 和 Anthropic 的所有能力：

- **ContentBlock 联合类型**：text / tool_use / tool_result / image / thinking
- **Message 接口**：role + content blocks + metadata
- **格式转换函数**：`toOpenAIMessages()` 在 Provider 适配器边界调用
- **工厂函数**：`userMessage()` / `assistantMessage()` 等简化创建

### 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| tool_result 的 role | `"tool_result"` 而非 `"tool"` | OpenAI 用 `"tool"`，Anthropic 不用 role 区分，取中性名 |
| content 总是数组 | `ContentBlock[]` 而非 `string \| ContentBlock[]` | 统一处理，避免条件分支 |
| cacheControl 字段 | 放在 Text block 内 | 只有 Anthropic 用，OpenAI 适配器忽略即可 |
| 转换函数放哪 | 放在 message.ts 内 | 单文件内聚，后续 Anthropic 转换函数也放这里 |

## 效果

### Before

```typescript
// 旧：创建消息时需要知道 OpenAI 的格式
contextManager.addAssistantMessage(text, [{
    callId: "call_123",
    name: "read_file",
    args: { path: "/tmp/foo" },
}]);
// → 内部存为 { role: "assistant", content: text, toolCalls: [...] }
// → getMessages() 时转为 { role: "assistant", tool_calls: [...] }
```

### After

```typescript
// 新：使用中性工厂函数
import { assistantMessage } from "../context/message.js";

const msg = assistantMessage("I'll read that file.", [{
    type: "tool_use",
    id: "call_123",
    name: "read_file",
    input: { path: "/tmp/foo" },
}]);
// → 发给 OpenAI 时：toOpenAIMessages([msg]) 自动转换
// → 发给 Anthropic 时：toAnthropicMessages([msg]) 另一套转换（Phase 2）
```

## 验证方式

```bash
# 1. 类型检查
npx tsc --noEmit src/context/message.ts

# 2. 手动验证转换逻辑（后续 Step 0.6/0.8 接入时会实际运行）
# toOpenAIMessages 应该将：
#   { role: "assistant", content: [{ type: "text", text: "hi" }, { type: "tool_use", ... }] }
# 转换为：
#   { role: "assistant", content: "hi", tool_calls: [{ id: "...", type: "function", function: {...} }] }
```
