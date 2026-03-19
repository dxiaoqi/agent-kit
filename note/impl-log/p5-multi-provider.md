# Phase 5：Multi-Provider LLM + Model Registry + CostTracker 实现日志

## 一、设计目标

1. **ModelRegistry** — 集中管理多模型 profile，按角色（main/compact/subagent）路由
2. **Anthropic Adapter** — 原生 Anthropic Messages API 适配器（含 prompt caching）
3. **Adapter Factory** — 根据 `provider` 字段自动选择适配器
4. **CostTracker** — 按模型累计 token 用量和费用，支持定价表
5. **Capabilities Detection** — 根据模型名自动推断能力和定价
6. **LLMClient 重构** — 兼容旧接口 + 新 ModelRegistry 路由

## 二、架构概览

```
┌──────────────────────────────────────────────────────────────┐
│  Bootstrap (main.ts)                                         │
│                                                              │
│  config.toml ──▶ ModelRegistry ──▶ LLMClient                │
│                   │ profiles[]      │ chat()                 │
│                   │ bindings{}      │ chatForRole()          │
│                   │ getForRole()    │ costs: CostTracker     │
│                   │                 │                         │
│                   ▼                 ▼                         │
│            ┌─────────────┐  ┌──────────────┐                │
│            │  Capabilities │  │ AdapterFactory│                │
│            │  inferCaps()  │  │ getAdapter()  │                │
│            │  inferPrice() │  │              │                │
│            └─────────────┘  └──────┬───────┘                │
│                                     │                         │
│                    ┌────────────────┼────────────┐           │
│                    ▼                ▼             ▼           │
│             ┌───────────┐   ┌───────────┐  ┌──────────┐     │
│             │ OpenAI    │   │ Anthropic │  │ (future) │     │
│             │ Adapter   │   │ Adapter   │  │ adapters │     │
│             └───────────┘   └───────────┘  └──────────┘     │
│                                     │                         │
│                              ┌──────────────┐                │
│                              │  CostTracker │                │
│                              │  per-model   │                │
│                              │  $, tokens,  │                │
│                              │  duration    │                │
│                              └──────────────┘                │
└──────────────────────────────────────────────────────────────┘
```

## 三、文件清单

| 文件 | 职责 | 状态 |
|------|------|------|
| `src/provider/types.ts` | 新增 `ModelRole`, `ModelCapabilities`, `ModelPricing` | 修改 |
| `src/provider/registry.ts` | `ModelRegistry` — 角色路由 + env 解析 + 大模型查找 | 新建 |
| `src/provider/capabilities.ts` | 模型能力矩阵 + 定价表（20+ 已知模型） | 新建 |
| `src/provider/cost.ts` | `CostTracker` — 按模型累计 token/费用/时间 | 新建 |
| `src/provider/adapters/anthropic.ts` | Anthropic 原生适配器（Messages API + prompt cache） | 新建 |
| `src/provider/adapters/factory.ts` | 适配器工厂 — 自动选择 + 缓存 | 新建 |
| `src/provider/client.ts` | `LLMClient` 重构 — ModelRegistry + CostTracker 集成 | 重写 |
| `src/kernel/agent.ts` | Agent 集成成本追踪 | 修改 |
| `src/config/config.ts` | ModelProfile 新增 `provider` 字段 | 修改 |
| `src/main.ts` | Bootstrap 使用 ModelRegistry + CostTracker | 修改 |
| `src/ui/screens/REPL.tsx` | 新增 `/cost` 命令 | 修改 |
| `.agent/config.toml` | 多模型配置示例 | 修改 |

## 四、核心设计

### 4.1 ModelRegistry

```typescript
class ModelRegistry {
    // 环境变量覆盖：MODEL_<ID>_API_KEY / MODEL_<ID>_BASE_URL
    get(id?: string): ProviderProfile;
    getForRole(role: ModelRole): ProviderProfile;
    findLargerModel(currentId: string): ProviderProfile | null;
    setBinding(role: ModelRole, id: string): void;
}
```

角色路由机制：
- `main` → 主对话模型（默认）
- `compact` → 压缩摘要模型（可用便宜快速模型）
- `subagent` → 子代理模型
- binding 缺失时回退到 `defaultId`

### 4.2 CostTracker

```typescript
class CostTracker {
    add(modelId, usage, pricing, durationMs): void;
    getSummary(): CostSummary;
    format(): string;          // "$0.0123 | 15.2K tokens | 3.4s API | 12.1s wall"
    formatDetailed(): string;  // 含 per-model 明细
}
```

成本计算公式：
```
cost = (promptTokens / 1M) × inputPerMillion
     + (completionTokens / 1M) × outputPerMillion
     + (cachedTokens / 1M) × cacheReadPerMillion
```

### 4.3 Anthropic Adapter

关键差异处理：

| OpenAI | Anthropic |
|--------|-----------|
| `system` 在 messages 数组中 | `system` 是独立参数 |
| `tool_calls` 在 assistant message 中 | `tool_use` 是 content block |
| `tool` role 返回结果 | `tool_result` 在 user message 中 |
| 无 prompt cache | `cache_control: { type: "ephemeral" }` |

**SDK 延迟加载**：`@anthropic-ai/sdk` 是可选依赖，仅在 `provider = "anthropic"` 时动态 import，未安装时给出友好提示。

### 4.4 能力自动推断

```typescript
inferCapabilities("claude-sonnet-4-20250514")
// → { functionCalling: true, vision: true, streaming: true, promptCaching: true, thinking: true }

inferPricing("gpt-4o-mini")
// → { inputPerMillion: 0.15, outputPerMillion: 0.6 }

inferProvider("claude-3-haiku")
// → "anthropic"
```

覆盖 20+ 已知模型系列：
- Claude 3/3.5/3.7/4 系列
- GPT-4o / o1 / o3 系列
- Gemini 2.0/2.5 系列
- DeepSeek V3 / R1

### 4.5 LLMClient 重构

保持向后兼容：

```typescript
// 旧接口（单适配器）——仍可用
new LLMClient(new OpenAIAdapter(), { maxRetries: 3 });
client.chat(messages, tools, profile, signal);

// 新接口（ModelRegistry + 自动适配器选择）
new LLMClient(modelRegistry, { maxRetries: 3 }, costTracker);
client.chatForRole("main", messages, tools, signal);
client.chat(messages, tools, specificProfile, signal);
```

## 五、配置示例

```toml
# 默认使用 Gemini
[models.default]
name          = "gemini-2.5-flash"
contextWindow = 128000

# 可选：Claude 作为第二模型
[models.claude]
name          = "claude-sonnet-4-20250514"
provider      = "anthropic"
contextWindow = 200000
maxTokens     = 8192

# 角色绑定
[modelBindings]
main       = "default"     # 主对话
compaction = "default"     # 压缩
subagent   = "default"     # 子代理
# main     = "claude"      # 可切换到 Claude
```

## 六、验证

```
$ npx tsc --noEmit    # ✓ 零错误
```

## 七、设计决策

1. **可选 SDK**：Anthropic SDK 通过 `Function('return import(...)')()` 动态加载，避免硬依赖
2. **适配器缓存**：同一 provider 类型共享适配器实例，但每个 baseUrl/apiKey 组合独立 client
3. **能力推断优先级**：用户显式配置 > 自动推断，`inferCapabilities` 仅作为默认值
4. **向后兼容**：`LLMClient` 构造函数同时接受 `ProviderAdapter`（旧）和 `ModelRegistry`（新）
5. **CostTracker 注入**：通过构造函数注入共享的 CostTracker，Agent 和 UI 可直接访问
