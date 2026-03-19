# Step 0.3: 错误分类体系

## 改动路径

```
新建  src/kernel/errors.ts
替代  src/utils/errors.ts （旧版只有 ConfigError，保留兼容）
```

## 思路

### 问题

旧版 Agent 循环只有一个 `catch (err: any)`，所有错误都一视同仁地终止：

```typescript
// 旧 src/agent/agent.ts
catch (err: any) {
    yield AgentEvent.error(err.message ?? String(err));
    yield AgentEvent.end(this.session.turnCount);
}
```

这意味着：
- rate limit (429) → 直接失败，不重试
- context overflow (400) → 直接失败，不压缩
- 网络抖动 → 直接失败，不重试

Claude Code 和 Kode-Agent 都有精细的错误分类恢复策略（见笔记第一章 1.5 节）。

### 方案

三层错误分类：

| 类别 | 恢复策略 | 典型场景 |
|------|---------|---------|
| `retryable` | 指数退避重试 | 429 rate limit / 502-504 / 网络超时 |
| `context_overflow` | 触发 auto_compact 后重试 | 400 + "context length exceeded" |
| `fatal` | 终止循环，上报用户 | 401 认证失败 / 未知错误 |

核心组件：
1. **AgentError 类**：携带 `category` + 可选 `retryAfterMs`
2. **classifyError() 函数**：将原始 API 错误转为分类错误
3. **parseRetryAfter()**：解析 HTTP `retry-after` 头（秒 or 日期）
4. **领域错误类型**：`ConfigError` / `ToolExecutionError` / `PermissionDeniedError`

### classifyError 的匹配规则

```
status === 429                                → retryable (+ retry-after)
status === 400 && /context.*length/           → context_overflow
status === 500                                → retryable
status === 502 | 503 | 504                    → retryable
type === "connection_error"                   → retryable
/ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed/ → retryable
其他                                           → fatal
```

## 效果

### Before

```typescript
// Agent 循环：所有错误直接死
catch (err) {
    yield AgentEvent.error(err.message);
    return;  // 死了
}
```

### After

```typescript
// Agent 循环：按类别恢复
catch (err) {
    const classified = classifyError(err);
    switch (classified.category) {
        case "retryable":
            await sleep(classified.retryAfterMs ?? backoff(attempt));
            continue;  // 重试
        case "context_overflow":
            await contextManager.compact();
            continue;  // 压缩后重试
        case "fatal":
            yield AgentEvent.error(classified.message);
            return;
    }
}
```

## 验证方式

```bash
# 1. 类型检查
npx tsc --noEmit src/kernel/errors.ts

# 2. 验证分类逻辑（手动）
# classifyError({ status: 429, message: "rate limited" })
#   → AgentError { category: "retryable" }
# classifyError({ status: 400, message: "context length exceeded" })
#   → AgentError { category: "context_overflow" }
# classifyError({ status: 401, message: "invalid api key" })
#   → AgentError { category: "fatal" }
```
