# 第八章：架构对比与实施路线图

> *"三种实现，一个目标——找到最适合自己的路径"*
> *—— 从对比中学习，用路线图执行*

---

## 一、三项目全维度横评

### 1.1 项目定位

| 维度 | learn-claude-code | Claude Code (逆向) | Kode-Agent |
|------|-------------------|-------------------|------------|
| **定位** | 教学课程（12 课） | 商业产品（闭源） | 开源复刻 |
| **语言** | Python | TypeScript (混淆) | TypeScript |
| **代码量** | ~3000 行 | ~30000 行（估） | ~20000 行 |
| **成熟度** | 概念验证 | 生产级 | 接近生产级 |
| **用户** | 开发者学习 | 终端用户 | 开发者 |

### 1.2 Agent Loop 对比

| 维度 | learn-claude-code | Claude Code | Kode-Agent | **agent-kit（当前）** |
|------|-------------------|-------------|------------|---------------------|
| 循环方式 | while 迭代 | AsyncGenerator（tt 函数） | 递归 AsyncGenerator | for 迭代 |
| 流式输出 | 无 | 完整 SSE 状态机 | SSE + 中间件 | OpenAI SDK 流式 |
| 事件协议 | 无 | CliMessage | Message yield | AgentEvent enum |
| 错误恢复 | 无 | 分类恢复（retry/compact/fatal） | withRetry + 模型切换 | 简单重试（3 次） |
| 中断支持 | 无 | AbortController | AbortController | 无 |
| 背压控制 | N/A | 事件优先级过滤 | 无 | 无 |

### 1.3 工具系统对比

| 维度 | learn-claude-code | Claude Code | Kode-Agent | **agent-kit** |
|------|-------------------|-------------|------------|--------------|
| 工具定义 | 字典分离 | 对象式 + Zod | 类式 + Zod + 泛型 | **无（桩函数）** |
| 工具数量 | 3-5 | 15 | 20+ | 0 |
| 输入校验 | 无 | Zod | Zod | N/A |
| 输出截断 | 50KB slice | normalizeToSize (smart) | 类似 | N/A |
| 并发控制 | 无 | 只读并行/写入串行 | ToolUseQueue 屏障 | N/A |
| 工具 Prompt | 简单描述 | 详细使用手册式 | 文件级 prompt | N/A |
| 流式进度 | 无 | AsyncGenerator | AsyncGenerator | N/A |

### 1.4 Prompt 工程对比

| 维度 | learn-claude-code | Claude Code | Kode-Agent | **agent-kit** |
|------|-------------------|-------------|------------|--------------|
| 架构 | 单一字符串 | 5 层模块化 | 分段 + Reminder | 硬编码字符串 |
| 模块数 | 1 | 12 | 5+ | 1 |
| 动态注入 | 无 | system-reminder + 条件模块 | systemReminder 事件 | 无 |
| 项目指令 | 无 | CLAUDE.md（层级化） | CLAUDE.md | AGENT.MD |
| 压缩 Prompt | 简单指令 | 9 段结构化 + analysis 标签 | 8 段结构化 | 无 |
| LLM 心理学 | 无 | 惩罚/情绪/禁止短语/重复 | 部分继承 | 无 |

### 1.5 上下文管理对比

| 维度 | learn-claude-code | Claude Code | Kode-Agent | **agent-kit** |
|------|-------------------|-------------|------------|--------------|
| Micro Compact | 有（替换大 result） | 有 | 有 | **无** |
| Auto Compact | 有（阈值触发） | 有 | 有（精确 token 计数） | **无** |
| Token 追踪 | 启发式 | 未知 | API usage 精确 | TokenUsage.add() |
| 外部记忆 | TodoManager + 磁盘 Tasks | TodoWrite 工具 | 无独立 Todo | **无** |
| 文件恢复 | 无 | 未知 | FileFreshnessService | **无** |
| 会话持久化 | .transcripts/ | 内置 | JSONL + UUID 链 | **无** |
| 成本追踪 | 无 | 每请求 + 会话累计 | costTracker | **无** |

### 1.6 权限系统对比

| 维度 | learn-claude-code | Claude Code | Kode-Agent | **agent-kit** |
|------|-------------------|-------------|------------|--------------|
| 模型 | 无门禁 | 路径感知 + 交互审批 | 完整规则引擎 | ApprovalPolicy 枚举 |
| 规则引擎 | bash 黑名单 | config + PB() | deny > ask > allow | **无** |
| 路径匹配 | safePath() | 工作区内/外 | gitignore 风格 glob | **无** |
| 持久化 | 无 | allowedTools config | session/project/user JSON | **无** |
| 安全底线 | 危险命令子串 | Docker-only bypass | 硬编码敏感路径 | **无** |

### 1.7 多模型集成对比

| 维度 | learn-claude-code | Claude Code | Kode-Agent | **agent-kit** |
|------|-------------------|-------------|------------|--------------|
| 提供商数 | 1（Anthropic 兼容） | 3（Anthropic/Bedrock/Vertex） | 10+（适配器模式） | 1（OpenAI 兼容） |
| 适配器 | 无 | SDK 内切换 | 抽象基类 + 多实现 | OpenAI SDK 直连 |
| 角色路由 | 无 | main/quick（硬编码） | main/task/compact/quick | main/compaction/subagent |
| 响应归一化 | N/A | 内部统一 | convertOpenAIToAnthropic | **无（依赖 OpenAI 格式）** |
| 重试策略 | 无 | 指数退避 + retry-after | 指数退避 + 错误分类 | 简单重试（3 次） |
| 成本计算 | 无 | per-million 定价 | per-token 定价 | **无** |
| Prompt Cache | 无 | cache_control: ephemeral | 支持 | **无** |

### 1.8 子代理对比

| 维度 | learn-claude-code | Claude Code | Kode-Agent | **agent-kit** |
|------|-------------------|-------------|------------|--------------|
| 基础模式 | 独立消息 + 摘要 | 独立消息 + 摘要 | Fork context + 摘要 | **SubagentConfig 定义，未实现** |
| 工具限制 | 无 Task | 无写工具 + 无 Task | 按类型配置 | N/A |
| 后台执行 | 守护线程 | 未知 | BackgroundAgentTask | **无** |
| 并发 | 无 | 最多 5 个并行 | 支持 | **无** |
| 持久队友 | s09-s11 | 无 | 无 | **无** |
| Worktree | s12 | 无 | 无 | **无** |

---

## 二、agent-kit 现状分析

### 2.1 已具备的基础

agent-kit 的当前代码库展示了一个清晰的骨架：

| 组件 | 文件 | 状态 | 评价 |
|------|------|------|------|
| CLI 入口 | `src/main.ts` | ✅ 完整 | Commander + REPL + 斜杠命令 |
| Agent 循环 | `src/agent/agent.ts` | ⚠️ 骨架 | 循环结构在，工具执行是桩 |
| 事件协议 | `src/agent/events.ts` | ✅ 良好 | 8 种事件类型，工厂方法 |
| 会话管理 | `src/agent/session.ts` | ✅ 良好 | 系统 prompt 构建，组件持有 |
| LLM 客户端 | `src/client/llm_client.ts` | ✅ 可用 | OpenAI SDK 流式 + 重试 |
| 模型注册表 | `src/client/model_registry.ts` | ✅ 良好 | 角色绑定 + 环境变量解析 |
| 流式事件 | `src/client/response.ts` | ✅ 良好 | 事件类型 + TokenUsage |
| 配置系统 | `src/config/config.ts` | ✅ 完整 | Zod schema + 校验 |
| 配置加载 | `src/config/loader.ts` | ✅ 完整 | TOML + 层级合并 + AGENT.MD |
| 上下文管理 | `src/context/manager.ts` | ⚠️ 基础 | 消息存取，无压缩/token 计数 |
| TUI | `src/ui/tui.ts` | ✅ 可用 | Readline + 事件消费 + Spinner |
| 错误类型 | `src/utils/errors.ts` | ✅ 简单 | ConfigError |

### 2.2 核心差距

按优先级排列，agent-kit 与生产级 Agent CLI 之间的差距：

#### P0：缺少基础工具（当前无法工作）

```typescript
// agent.ts 中的桩函数
private getToolSchemas(): ToolSchema[] | null {
    return null;  // ← 没有工具
}

private async executeTools(toolCalls: ToolCall[]): Promise<boolean> {
    return true;   // ← 什么都不做
}
```

没有工具，Agent 只能聊天——无法读文件、写代码、执行命令。

#### P1：缺少上下文管理

- 无 Token 计数 → 无法知道何时溢出
- 无压缩机制 → 长对话必然 OOM
- 无 Todo 系统 → 压缩后丢失任务状态

#### P2：缺少权限系统

- `ApprovalPolicy` 枚举已定义但未接入
- 无规则引擎、无路径匹配、无审批流程

#### P3：缺少多提供商适配

- 仅 OpenAI SDK → 无法直接使用 Anthropic Messages API
- 无 thinking、cache_control 等 Anthropic 专有能力

#### P4：缺少子代理

- `SubagentConfig` 已在 config schema 中定义，但未实现

### 2.3 架构优势

agent-kit 也有一些值得保留的设计优势：

| 优势 | 说明 |
|------|------|
| **ESM + TypeScript 严格模式** | 现代化基础，类型安全 |
| **Zod 配置 schema** | 运行时校验 + 类型推断 |
| **TOML 分层配置** | 系统级 + 项目级，清晰 |
| **事件驱动架构** | `AgentEvent` 已解耦 Agent 和 UI |
| **角色绑定模型注册表** | main/compaction/subagent 语义已预留 |
| **AGENT.MD 注入** | 项目指令支持已就绪 |
| **Commander CLI** | 命令行框架成熟 |

---

## 三、实施路线图

### 3.1 分阶段策略

```
Phase 0 (基础闭环)    ← 能用
Phase 1 (核心增强)    ← 好用
Phase 2 (生产级)      ← 可靠
Phase 3 (高级功能)    ← 强大
```

### 3.2 Phase 0：基础闭环（最小可用 Agent）

**目标**：Agent 能读文件、写文件、执行命令、搜索代码。

**工期估算**：2-3 天

| 任务 | 对应章节 | 改动文件 | 优先级 |
|------|---------|---------|--------|
| 实现 ToolDef 接口 + ToolRegistry | 第二章 3.1-3.2 | 新建 `src/tools/registry.ts` | P0 |
| 实现 bash 工具 | 第二章 3.3 | 新建 `src/tools/bash.ts` | P0 |
| 实现 read_file 工具 | 第二章 3.3 | 新建 `src/tools/read_file.ts` | P0 |
| 实现 write_file 工具 | 第二章 3.3 | 新建 `src/tools/write_file.ts` | P0 |
| 实现 edit_file 工具 | 第二章 3.3 | 新建 `src/tools/edit_file.ts` | P0 |
| 实现 glob + grep 工具 | 第二章 3.3 | 新建 `src/tools/glob.ts`, `grep.ts` | P0 |
| 接入 Agent 循环 | 第二章 3.4 | 修改 `src/agent/agent.ts` | P0 |
| normalizeToSize 输出截断 | 第二章 3.2 | 新建 `src/utils/normalize.ts` | P0 |

**关键改动**：替换 `agent.ts` 中的两个桩函数：

```typescript
// Before
private getToolSchemas(): ToolSchema[] | null { return null; }
private async executeTools(toolCalls: ToolCall[]): Promise<boolean> { return true; }

// After
private getToolSchemas(): ToolSchema[] | null {
    return this.toolRegistry.getSchemas();
}

private async executeTools(toolCalls: ToolCall[]): Promise<boolean> {
    let hasToolUse = false;
    for (const tc of toolCalls) {
        const output = await this.toolRegistry.execute(tc.name, tc.args);
        this.session.contextManager.addToolResult(tc.callId, output);
        hasToolUse = true;
    }
    return hasToolUse;
}
```

### 3.3 Phase 1：核心增强（日常可用）

**目标**：长对话不崩溃，有基本安全保障，Prompt 质量提升。

**工期估算**：3-5 天

| 任务 | 对应章节 | 改动文件 | 优先级 |
|------|---------|---------|--------|
| Token 追踪器 | 第四章 3.1 | 新建 `src/context/token_tracker.ts` | P1 |
| Micro Compactor | 第四章 3.2 | 新建 `src/context/micro_compact.ts` | P1 |
| Auto Compact 引擎 | 第四章 3.5 | 新建 `src/context/compact.ts` | P1 |
| Prompt 模块系统 | 第三章 3.1-3.2 | 新建 `src/prompt/modules.ts`, `registry.ts` | P1 |
| Reminder 注入 | 第三章 3.3 | 新建 `src/prompt/reminder.ts` | P1 |
| 错误分类恢复 | 第一章 3.3 | 修改 `src/agent/agent.ts` | P1 |
| 基础权限检查 | 第五章 3.5 | 新建 `src/permissions/engine.ts` | P1 |
| 路径安全检查 | 第五章 3.2 | 新建 `src/permissions/path.ts` | P1 |

**增强 ContextManager**：

```typescript
// 在 Phase 1 中升级 context/manager.ts
class ContextManager {
    private tokenTracker: TokenTracker;
    private microCompactor: MicroCompactor;

    addToolResult(toolCallId: string, content: string): void {
        // 1. normalizeToSize 截断
        const normalized = normalizeToSize(content, 30_000);
        // 2. 存入消息
        this.messages.push({ role: "tool", toolCallId, content: normalized });
    }

    shouldCompact(): boolean {
        return this.tokenTracker.percentage > 0.7;
    }

    microCompact(): void {
        this.microCompactor.compact(this.messages);
    }
}
```

### 3.4 Phase 2：生产级（可靠 + 可观测）

**目标**：多提供商支持，成本追踪，会话持久化，完整权限。

**工期估算**：5-7 天

| 任务 | 对应章节 | 改动文件 | 优先级 |
|------|---------|---------|--------|
| Anthropic 适配器 | 第六章 3.3 | 新建 `src/client/adapters/anthropic.ts` | P2 |
| 适配器工厂 | 第六章 3.3 | 新建 `src/client/adapters/factory.ts` | P2 |
| 成本追踪器 | 第六章 3.4 | 新建 `src/client/cost_tracker.ts` | P2 |
| Prompt Cache 支持 | 第六章 1.10 | 修改 Anthropic 适配器 | P2 |
| JSONL 会话日志 | 第四章 3.3 | 新建 `src/context/transcript.ts` | P2 |
| 文件新鲜度追踪 | 第四章 3.4 | 新建 `src/context/freshness.ts` | P2 |
| Todo 外部记忆 | 第四章 3.6 | 新建 `src/tools/todo.ts` | P2 |
| 完整规则引擎 | 第五章 3.3-3.5 | 新建 `src/permissions/rules.ts`, `store.ts` | P2 |
| 审批 UI | 第五章 3.7 | 修改 `src/ui/tui.ts` | P2 |
| AbortController 中断 | 第一章 3.3 | 修改 `src/agent/agent.ts` | P2 |

### 3.5 Phase 3：高级功能（竞争力）

**目标**：子代理，并发工具执行，高级 Prompt 技巧。

**工期估算**：5-7 天

| 任务 | 对应章节 | 改动文件 | 优先级 |
|------|---------|---------|--------|
| 子代理执行引擎 | 第七章 3.3 | 新建 `src/subagent/runner.ts` | P3 |
| 子代理类型注册 | 第七章 3.2 | 新建 `src/subagent/registry.ts` | P3 |
| Task + TaskOutput 工具 | 第七章 3.5 | 新建 `src/tools/task.ts` | P3 |
| 后台任务管理 | 第七章 3.4 | 新建 `src/subagent/background.ts` | P3 |
| 并发工具执行 | 第七章 3.7 | 修改 `src/agent/agent.ts` | P3 |
| 安全模块 + 命令注入检测 | 第三章 3.2 | 新建 `src/prompt/security.ts` | P3 |
| 强调层级 + FORBIDDEN PHRASES | 第三章 3.2 | 修改 prompt 模块 | P3 |
| ANR 检测 | 第四章 3.10 | 新建 `src/utils/anr.ts` | P3 |
| 内存压力监控 | 第四章 3.10 | 新建 `src/utils/memory.ts` | P3 |
| 层级化 AGENT.MD | 第四章 1.10 | 修改 `src/config/loader.ts` | P3 |

---

## 四、目录结构规划

Phase 3 完成后的目标目录结构：

```
src/
├── main.ts                          # CLI 入口
├── agent/
│   ├── agent.ts                     # Agent 核心循环
│   ├── session.ts                   # 会话管理
│   └── events.ts                    # 事件协议
├── client/
│   ├── llm_client.ts                # 统一 LLM 客户端（重试 + 路由）
│   ├── model_registry.ts            # 模型注册表 + 角色绑定
│   ├── cost_tracker.ts              # 成本追踪
│   ├── response.ts                  # 流式事件类型
│   └── adapters/
│       ├── types.ts                 # LLMAdapter 接口
│       ├── factory.ts               # 适配器工厂
│       ├── anthropic.ts             # Anthropic 适配器
│       └── openai.ts                # OpenAI 适配器
├── config/
│   ├── config.ts                    # Zod schema
│   └── loader.ts                    # TOML 加载 + 层级合并
├── context/
│   ├── manager.ts                   # 增强版上下文管理器
│   ├── token_tracker.ts             # Token 计数
│   ├── micro_compact.ts             # Micro Compactor
│   ├── compact.ts                   # Auto Compact 引擎
│   ├── transcript.ts                # JSONL 会话日志
│   └── freshness.ts                 # 文件新鲜度追踪
├── permissions/
│   ├── engine.ts                    # 决策引擎
│   ├── rules.ts                     # 规则匹配器
│   ├── store.ts                     # 规则存储（session/project/user）
│   └── path.ts                      # 敏感路径检测
├── prompt/
│   ├── modules.ts                   # Prompt 模块定义
│   ├── registry.ts                  # 模块注册 + 组装引擎
│   ├── reminder.ts                  # Reminder 注入
│   └── security.ts                  # 安全约束模块
├── subagent/
│   ├── runner.ts                    # 子代理执行引擎
│   ├── registry.ts                  # 类型注册表
│   └── background.ts               # 后台任务管理
├── tools/
│   ├── registry.ts                  # 工具注册表
│   ├── types.ts                     # ToolDef 接口
│   ├── bash.ts                      # Bash 工具
│   ├── read_file.ts                 # 读文件
│   ├── write_file.ts                # 写文件
│   ├── edit_file.ts                 # 编辑文件
│   ├── glob.ts                      # 文件搜索
│   ├── grep.ts                      # 内容搜索
│   ├── todo.ts                      # Todo 外部记忆
│   └── task.ts                      # Task + TaskOutput
├── ui/
│   └── tui.ts                       # 终端 UI
└── utils/
    ├── errors.ts                    # 错误类型
    ├── normalize.ts                 # normalizeToSize
    ├── anr.ts                       # ANR 检测
    └── memory.ts                    # 内存监控
```

---

## 五、设计原则清单

从七章分析中提炼的 agent-kit 核心设计原则：

### 架构原则

| # | 原则 | 来源 |
|---|------|------|
| A1 | **循环不变，能力叠加** — Agent 核心循环的结构永远不变，新功能通过注册工具/模块/钩子叠加 | 第一章 |
| A2 | **事件驱动解耦** — Agent 只 yield 事件，UI 只消费事件，二者不互相引用 | 第一章 |
| A3 | **接口在边界** — 格式转换只发生在 Agent↔LLM 和 Agent↔工具 的两个边界 | 第六章 |
| A4 | **配置优先于代码** — 工具集、Prompt 模块、Agent 类型都应该可通过配置调整 | 第七章 |

### 安全原则

| # | 原则 | 来源 |
|---|------|------|
| S1 | **安全默认** — 未知操作默认拒绝，用户显式授权才能扩大能力 | 第五章 |
| S2 | **Deny 永远优先** — deny > ask > allow，不可逆覆盖 | 第五章 |
| S3 | **写操作留在主代理** — 子代理默认只读，写操作在用户可见的主循环中执行 | 第七章 |
| S4 | **安全底线不可逾越** — 即使 bypass 模式也不写 .ssh/.env | 第五章 |

### Prompt 原则

| # | 原则 | 来源 |
|---|------|------|
| P1 | **约束即自由** — 越多具体约束反而让输出质量越高 | 第三章 |
| P2 | **多通道强化** — 关键规则在 4 个位置以不同措辞重复 | 第三章 |
| P3 | **工具 description 就是 prompt** — 描述质量直接决定模型使用工具的正确率 | 第二章 |
| P4 | **强调层级** — RULE 0 > CRITICAL > IMPORTANT，约束冲突时有明确优先级 | 第三章 |

### 上下文原则

| # | 原则 | 来源 |
|---|------|------|
| C1 | **战略性遗忘** — 信息从 L1（上下文）→ L2（内存）→ L3（磁盘），而非删除 | 第四章 |
| C2 | **外部存储 > 内部记忆** — 磁盘文件比上下文窗口可靠，Agent 可以主动读回 | 第四章 |
| C3 | **Token 是货币** — 每个设计决策都在做 token 交易，用 N token 换取 M token 的价值 | 第四章 |
| C4 | **恢复优先** — 压缩后第一件事是恢复关键上下文，而非继续工作 | 第四章 |

---

## 六、关键技术决策清单

在实施过程中需要做的关键技术决策：

| 决策点 | 选项 | 推荐 | 理由 |
|--------|------|------|------|
| 内部消息格式 | OpenAI 格式 / Anthropic 格式 / 自定义 | **自定义中性格式** | 不绑定 SDK，表达两者超集 |
| Zod 运行时 | 保留 / 移除 | **保留** | 工具输入校验 + 配置校验 + JSON Schema 生成 |
| 工具实现语言 | 纯 TS / 支持外部进程 | **纯 TS 优先** | 开发效率和类型安全，后续可加 MCP 支持 |
| 权限存储格式 | JSON / TOML / YAML | **JSON** | 与现有 TOML 配置分离，权限规则更适合 JSON |
| 压缩模型 | 复用主模型 / 专用模型 | **复用主模型（先）** | 简化实现，质量有保障；后续可路由到 quick |
| 子代理架构 | 进程内 / 子进程 | **进程内** | 共享工具注册表和 LLM 客户端，复杂度低 |
| UI 框架 | Readline / Ink (React) | **Readline（先）** | 现有实现可用，Ink 是后续优化方向 |
| 包管理 | npm / pnpm / bun | **保持现有（npm）** | 已有 package.json 可用 |

---

## 七、章节索引

完整的笔记系列索引：

| 章节 | 文件 | 核心主题 |
|------|------|---------|
| 第一章 | `note/01-agent-loop.md` | Agent 循环：迭代式 AsyncGenerator、事件协议、错误恢复、流式背压 |
| 第二章 | `note/02-tool-system.md` | 工具系统：ToolDef + ToolRegistry、Zod 校验、normalizeToSize、沙箱、WeakRef 缓存 |
| 第三章 | `note/03-prompt-engineering.md` | Prompt 工程：5 层模块化、Reminder 注入、LLM 心理学、强调层级、命令注入检测 |
| 第四章 | `note/04-context-management.md` | 上下文管理：三层压缩、Token 追踪、Todo 外部记忆、文件恢复、ANR 检测、三层缓存 |
| 第五章 | `note/05-permission-system.md` | 权限系统：模式设计、deny>ask>allow 规则引擎、路径 glob 匹配、审批流程 |
| 第六章 | `note/06-multi-provider-llm.md` | 多模型集成：适配器模式、SSE 归一化、角色路由、成本追踪、Prompt Cache |
| 第七章 | `note/07-subagent-pattern.md` | 子代理模式：七级演进、上下文隔离、后台任务、持久队友、Worktree 隔离 |
| 第八章 | `note/08-architecture-comparison.md` | 架构对比：三项目横评、agent-kit 差距分析、四阶段实施路线图 |

**参考资料**：

| 资料 | 位置 |
|------|------|
| Claude Code 逆向 prompt/工具 | `origin/claude-code-reverse-main/results/` |
| Claude Code Southbridge 分析 | `origin/southbridge-claude-code-analysis/README.md` |
| learn-claude-code 课程代码 | `origin/learn-claude-code-main/agents/` |
| learn-claude-code 中文文档 | `origin/learn-claude-code-main/docs/zh/` |
| Kode-Agent 源码 | `origin/Kode-Agent-main/src/` |
