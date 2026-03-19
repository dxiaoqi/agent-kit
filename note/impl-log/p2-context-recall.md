# Phase 2 扩展：话题回温（Context Recall）

> 实现日期：2026-03-14  
> 状态：✅ typecheck 通过（零错误）

---

## 一、问题定义

压缩机制解决了"上下文满了怎么办"，但引入了新问题：**被压缩的历史话题如果与当前对话相关，LLM 会"失忆"**。

例如用户之前讨论过 `config.toml` 的配置格式，被压缩后，用户再问 "配置文件的格式规则是什么"，LLM 只能看到一个摘要，丢失了具体细节。

### 目标

在对话进行过程中，**自动识别新输入与被压缩历史的相关性**，将相关片段动态恢复到上下文中。

---

## 二、架构设计

```
                         ┌──────────────────────────────────────┐
                         │        CompactIndexStore             │
                         │  ┌──────────────────────────────┐   │
auto_compact 时 ──────►  │  │ Entry #1                     │   │
                         │  │  keywords: [config, toml, ...]│   │
                         │  │  filePaths: [.agent/config...]│   │
                         │  │  toolNames: [read_file, ...]  │   │
                         │  │  summary: "讨论了配置格式..."  │   │
                         │  │  originalMessages: Message[]  │   │
                         │  └──────────────────────────────┘   │
                         │  ┌──────────────────────────────┐   │
                         │  │ Entry #2                     │   │
                         │  │  keywords: [agent, loop, ...]│   │
                         │  │  ...                         │   │
                         │  └──────────────────────────────┘   │
                         └──────────────┬───────────────────────┘
                                        │
 用户输入 "配置格式规则"                │
         │                              │
         v                              v
  ┌─────────────┐           ┌──────────────────┐
  │ extractKey- │           │  TopicMatcher     │
  │  words()    │──────────►│  matchTopics()    │
  └─────────────┘           │  三维匹配 + 衰减   │
                            └────────┬─────────┘
                                     │ RecallMatch[]
                                     v
                            ┌──────────────────┐
                            │ ContextRecovery   │
                            │ recoverContext()  │
                            │ (token 预算控制)   │
                            └────────┬─────────┘
                                     │ Message[]
                                     v
                            注入到 prepareForLLMCall()
                            [system] → [recovered] → [messages]
```

### 核心设计决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 匹配策略 | TF-IDF 关键词 | 零外部依赖，无需 embedding 模型 |
| 索引存储 | 内存中 | 单会话生命周期，无需持久化索引 |
| 回温位置 | system prompt 之后、当前消息之前 | 提供上下文但不干扰当前对话流 |
| 预算控制 | contextWindow 的 10% | 防止回温内容反过来撑爆窗口 |
| 时间衰减 | 半衰期 30 分钟 | 越久远的内容匹配权重越低 |

---

## 三、新增文件

### `src/context/recall.ts`

**约 280 行**，包含四个核心模块：

#### 3.1 关键词提取 `extractKeywords(text)`

多策略联合提取：
- **文件路径**：正则匹配 `./src/main.ts` 等格式，同时提取 basename
- **标识符**：匹配 camelCase/PascalCase，拆解为子词（`contextManager` → `context`, `manager`）
- **中文关键词**：连续 2+ 个中文字符
- **通用分词**：按标点/空格分割，去停用词（英文 + 中文 + Agent 噪声词），去短词（<3 字符）

#### 3.2 CompactIndexStore

每次 auto_compact 时调用 `addEntry(messages, summary)`：
- 从被压缩的消息中提取 `keywords`, `filePaths`, `toolNames`
- 保存原始消息快照（用于精确恢复）
- 保存 LLM 生成的摘要

#### 3.3 TopicMatcher `matchTopics(input, recentMessages, index)`

三维相关性评分：

```
score = (keywordScore + pathScore + toolScore) × (0.3 + 0.7 × timeDecay)

keywordScore = matchedCount / √(totalKeywords)   ← TF-IDF 近似
pathScore    = matchedPaths × 0.3                 ← 路径匹配权重高
toolScore    = matchedTools × 0.1                 ← 工具名作为辅助信号
timeDecay    = 0.5 ^ (ageMinutes / 30)            ← 半衰期 30 分钟
```

**查询来源**：不仅看用户最新输入，还融合最近 4 条消息的内容，捕捉多轮对话中的话题延续。

**最低阈值**：score ≥ 0.15 才触发回温，避免噪声匹配。

#### 3.4 ContextRecovery `recoverContext(matches, tokenBudget)`

恢复策略：
1. 按匹配分数降序处理每个命中
2. 从原始消息中筛选**包含匹配关键词最多的消息**（最多 6 条）
3. 如果预算允许，附带该段的 LLM 摘要提供全局上下文
4. 严格遵守 token 预算，超预算立即停止
5. 包装为 `[Recovered context from earlier conversation — relevance: 73%]` 格式

---

## 四、修改文件

### `src/context/manager.ts`

- 新增 `CompactIndexStore` 成员
- 新增 `recallBudgetPercent` 配置项（默认 10%）
- `runAutoCompact()` / `forceCompact()`：压缩后自动调用 `compactIndex.addEntry()`
- `prepareForLLMCall()`：micro_compact 后执行 `tryRecall()`，将恢复的消息注入到 system prompt 之后
- 新增 `tryRecall()` 私有方法：提取最后一条 user 消息 → matchTopics → recoverContext
- 新增 `recall` / `indexedCompacts` getter 暴露回温状态

### `src/kernel/agent.ts`

- `getContextStats()` 扩展：新增 `indexedCompacts`, `lastRecall` 字段

### `src/ui/screens/REPL.tsx`

- `/status` 命令：显示话题索引数和最近一次回温信息

---

## 五、运行时行为示例

```
场景：长会话中压缩了关于 "TOML 配置格式" 的讨论

Turn 1-20: 讨论配置格式、tool 系统、UI 等
  → auto_compact 触发
  → CompactIndex #1: keywords=[config, toml, format, agent, ...], 
    filePaths=[.agent/config.toml], summary="讨论了..."

Turn 21-40: 讨论 UI 渲染
  → auto_compact 触发
  → CompactIndex #2: keywords=[ink, react, spinner, repl, ...],
    filePaths=[src/ui/...], summary="实现了..."

Turn 41: 用户输入 "config.toml 的 maxTurns 应该放在哪个 section？"
  → extractKeywords → [config, toml, maxturns, section]
  → matchTopics:
      #1: keywordMatch=[config, toml] pathMatch=[.agent/config.toml] → score 0.72
      #2: keywordMatch=[] → score 0.0
  → recoverContext(#1, budget=12800):
      从 #1 的原始消息中找到包含 "config" 和 "toml" 的 4 条消息
      注入为 [Recovered context — relevance: 72%]
  → LLM 收到：system prompt + [recovered] + [compressed summary] + 当前消息
  → LLM 能看到之前关于配置格式的具体讨论细节
```

---

## 六、关键特性

| 特性 | 实现 |
|------|------|
| 自动触发 | 每次 `prepareForLLMCall()` 自动检查，无需手动操作 |
| 零额外 API 调用 | 纯关键词匹配，不调用 LLM 也不需要 embedding |
| Token 安全 | 严格预算（contextWindow × 10%），不会撑爆窗口 |
| 时间衰减 | 越久远的内容权重越低，自然淘汰 |
| 多维匹配 | 关键词 + 文件路径 + 工具名 三重信号 |
| 透明可观测 | `/status` 显示索引数和回温详情 |

---

## 七、验证

```bash
npx tsc --noEmit  # ✅ 零错误
```

---

## 八、扩展路线

| 方向 | 说明 |
|------|------|
| Embedding 匹配 | 用本地小模型（如 all-MiniLM-L6-v2）做语义匹配，提升召回率 |
| 索引持久化 | 将 CompactIndex 写入磁盘，支持跨会话回温 |
| 主动回温 | 检测到回温后，发出 `context_recall` 事件，UI 显示 "恢复了之前的讨论" |
| 双向链接 | 回温消息中标记来源 Entry ID，LLM 可以引用 |
| 衰减调优 | 允许用户配置半衰期，或按话题重要性动态调整 |
