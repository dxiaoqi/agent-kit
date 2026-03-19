# Step 0.1: StreamEvent → Discriminated Union

## 改动路径

```
新建  src/provider/types.ts
保留  src/client/response.ts （旧版，后续 Step 0.6 删除）
```

## 思路

### 问题

旧版 `StreamEvent` 使用 class + 7 个位置可选参数：

```typescript
// 旧 src/client/response.ts
class StreamEvent {
    constructor(
        type, textDelta?, error?, finishReason?,
        toolCallDelta?, toolCall?, usage?, toolCalls?
    ) {}
}
```

调用时出现大量无意义的 `undefined` 占位：

```typescript
yield new StreamEvent(
    StreamEventType.TOOL_CALL_COMPLETE,
    undefined, undefined, undefined, undefined,  // 5 个 undefined
    new ToolCall(...)
);
```

这带来三个问题：
1. **可读性差**：无法从调用处看出传了什么
2. **类型不安全**：所有字段都是 optional，编译器无法帮你检查"text_delta 事件必须有 text"
3. **容易出错**：参数位置搞错就是静默 bug

### 方案

改用 **discriminated union**（区分联合类型），每种事件只包含自己需要的字段：

```typescript
type StreamEvent =
    | { type: "text_delta";         text: string }
    | { type: "tool_call_complete"; toolCall: ToolCall }
    | { type: "error";              error: string; retryable: boolean }
    // ...
```

配合 `switch (event.type)` 使用时，TypeScript 会自动收窄类型——`case "text_delta"` 分支内 `event.text` 确定存在。

### 额外改进

1. **TokenUsage 从 class → interface + 工厂函数**：不需要 class 的继承/方法开销，纯数据用 interface
2. **ToolCall 从 class → interface**：同理
3. **StreamEvents 命名空间**：提供工厂函数 `StreamEvents.textDelta(text)` 替代 `new StreamEvent(type, ...)`
4. **ProviderAdapter 接口**：预定义适配器契约，为 Phase 0.6 拆分 OpenAI 适配器做准备
5. **ProviderProfile 接口**：从 ModelProfile 重命名，语义更清晰

## 效果

### Before

```typescript
// 创建事件：5 个 undefined
yield new StreamEvent(StreamEventType.TOOL_CALL_COMPLETE, undefined, undefined, undefined, undefined, toolCall);

// 消费事件：需要手动判断字段存在
if (event.type === StreamEventType.TEXT_DELTA && event.textDelta) {
    text += event.textDelta.text;
}
```

### After

```typescript
// 创建事件：只传需要的字段
yield StreamEvents.toolCallComplete(toolCall);

// 消费事件：switch 自动收窄
switch (event.type) {
    case "text_delta":
        text += event.text;  // ← TypeScript 知道 text 一定存在
        break;
}
```

## 验证方式

```bash
# 1. 类型检查通过
npx tsc --noEmit src/provider/types.ts

# 2. 确认 discriminated union 正常工作（在消费方用 switch）
# → 见后续 Step 0.6 的 OpenAI 适配器实现

# 3. 确认旧文件仍存在（不破坏现有代码，渐进迁移）
ls src/client/response.ts
```

当前阶段新旧文件并存。旧的 `src/client/response.ts` 在 Phase 0.6（适配器拆分）完成后删除。
