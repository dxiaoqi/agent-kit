# Phase 2 扩展：认知模型对齐改进

> 实现日期：2026-03-14  
> 状态：✅ typecheck 通过（零错误）

---

## 一、认知科学理论映射

### 改进前后对照

| 脑科学机制 | 改进前 | 改进后 |
|---|---|---|
| **杏仁核编码增强** | 所有消息平等对待 | Salience Tagging：错误/纠正/决策 = critical，深加工/TODO = high |
| **记忆再固化** | 回温不影响索引 | Reconsolidation：回温后更新时间戳 + 提升权重 + 扩展关键词 |
| **间隔重复效应** | 固定半衰期 30 分钟 | 自适应衰减：halfLife = 30 × 1.5^(recallCount)，回温越多衰减越慢 |
| **舌尖现象 (TOT)** | 弱匹配直接丢弃 | Metamemory Hints：0.05-0.15 分区注入"模糊提示" |
| **加工深度** | 读/写权重固定 | 写操作消息标记为 high salience，免于 micro_compact |
| **前瞻性记忆** | TODO 不受保护 | TODO 模式匹配 → high salience，压缩时优先保留 |

### 完整认知模型映射

```
人脑记忆系统                          agent-kit 实现
─────────────────                    ─────────────────────
感觉记忆（<1s）                      工具原始输出（raw tool_result）
  ↓ 注意力过滤                         ↓ micro_compact
短期记忆（7±2 项）                   上下文窗口（tokenTracker 管理）
  ↓ 海马体编码                         ↓ auto_compact + summarizer
长期记忆                             CompactIndex + transcript 磁盘

杏仁核 → 情绪增强编码                salience.ts → detectSalience()
  critical/high = 抗遗忘               critical/high = 免裁剪 + 摘要优先保留

再固化 → 提取后重新编码              recall.ts → reinforce()
  记忆每次提取都变强                   recallCount++, 时间戳更新, 关键词扩展

间隔重复 → 遗忘曲线变平缓            matchTopics() 自适应半衰期
  复习 N 次后半衰期指数增长            halfLife = 30 × 1.5^N

线索回忆 → 编码上下文匹配            extractKeywords() 三维索引
  提取线索 = 编码时的上下文             keywords + filePaths + toolNames

舌尖现象 → 模糊感觉"我知道"          tryRecall() metamemory hints
  TOT 状态 → 引导搜索                  弱匹配 → 注入提示而非完整恢复
```

---

## 二、新增文件

### `src/context/salience.ts`

**约 130 行**，核心组件：

#### `detectSalience(msg): SalienceLevel`

多信号检测器，优先级排序取最高权重：

| 信号 | 权重 | 等级 | 认知科学基础 |
|------|------|------|---|
| 用户纠正 ("不对"/"actually"/"please fix") | 10 | critical | 自我参照效应 + 错误信号 |
| 工具执行错误 (isError=true) | 9 | critical | 杏仁核对失败的强编码 |
| 文本含错误关键词 | 8 | critical | 冯·雷斯托夫效应（异常事件显著） |
| 架构/设计决策 | 6 | high | 深加工编码 |
| TODO / 待办项 | 5 | high | 前瞻性记忆 |
| 写操作 (write_file/edit_file) | 4 | high | 加工深度理论 |
| 多工具调用 (≥3) | 3 | high | 组块化（chunking） |
| 短消息 (<30 字符) | 1 | low | 浅加工 |
| 纯读操作 | 1 | low | 感觉记忆级 |

#### `salienceWeight(level): number`

```
critical: 4.0  →  记忆强度是 normal 的 4 倍
high:     2.0  →  记忆强度是 normal 的 2 倍
normal:   1.0  →  基线
low:      0.5  →  加速遗忘
```

---

## 三、修改文件

### `src/context/message.ts`

- 新增 `SalienceLevel` 类型（"critical" | "high" | "normal" | "low"）
- `MessageMetadata` 新增 `salience?: SalienceLevel` 字段

### `src/context/compact.ts`

- `microCompact()` 增加杏仁核保护：`critical` 和 `high` salience 的 tool_result 消息免于裁剪
- 保持 `KEEP_RECENT_TOOL_RESULTS = 3` 对普通消息不变

### `src/context/summarizer.ts`

- `COMPACT_SYSTEM_PROMPT` 增加指令：标记 `[CRITICAL]` / `[HIGH IMPORTANCE]` 的内容必须完整保留
- `summarize()` 中为每条消息添加 salience 标签前缀，引导 LLM 摘要时优先保留

### `src/context/recall.ts`

**CompactIndexEntry 新增字段：**
- `recallCount: number` — 被回温次数
- `lastRecalledAt: number` — 最近回温时间
- `salienceScore: number` — 高重要性消息占比

**CompactIndexStore 新增方法：**
- `reinforce(entryId, newKeywords?)` — 再固化：更新时间、递增计数、扩展关键词

**matchTopics() 评分公式改进：**
```
旧公式：
  score = rawScore × (0.3 + 0.7 × timeDecay)

新公式：
  halfLife = 30 × 1.5^(recallCount)        ← 间隔重复使衰减变慢
  lastTouch = max(timestamp, lastRecalledAt) ← 再固化重置衰减起点
  timeDecay = 0.5^(age / halfLife)
  reconBoost = 1 + min(recallCount × 0.15, 0.6)  ← 回温越多越容易再激活
  salienceBoost = 1 + salienceScore × 0.5         ← 重要内容更抗遗忘
  score = rawScore × (0.3 + 0.7 × timeDecay) × reconBoost × salienceBoost
```

### `src/context/manager.ts`

**tryRecall() 重构为三段逻辑：**

1. 降低匹配阈值到 0.05，分离强匹配（≥0.15）和弱匹配（0.05-0.15）
2. 强匹配 → 完整回温 + Reconsolidation（reinforce 被回温的索引）
3. 弱匹配 → Metamemory Hint 注入（不回温原始内容，仅告诉 LLM "你可能讨论过..."）

**消息入口自动标记 salience：**
- `addUserMessage()` / `addAssistantMessage()` / `addToolResult()` 均调用 `detectSalience()` 自动标记

**RecallInfo 扩展：**
- 新增 `metamemoryHints: string[]` 字段

---

## 四、数据流全景（改进后）

```
用户输入 "config.toml 的格式规则？"
    │
    ├→ detectSalience() → "normal"
    ├→ ctx.addUserMessage()  [salience: normal, timestamp: now]
    │
    ├→ prepareForLLMCall()
    │   ├→ microCompact()
    │   │   └→ 跳过 salience=critical/high 的 tool_result ← 杏仁核保护
    │   │
    │   └→ tryRecall()
    │       ├→ matchTopics(minScore=0.05)
    │       │   ├→ Entry #1: score=0.72 (config+toml 关键词匹配)
    │       │   │   ├→ halfLife = 30 × 1.5^2 = 67.5 min ← 被回温过 2 次
    │       │   │   ├→ reconBoost = 1.30
    │       │   │   ├→ salienceBoost = 1.25 (50% critical 消息)
    │       │   │   └→ final score = 0.72 → 强匹配 ✓
    │       │   │
    │       │   └→ Entry #3: score=0.09 (仅 "格式" 关键词弱匹配)
    │       │       └→ → 元认知区域
    │       │
    │       ├→ 强匹配 → recoverContext(#1) + reinforce(#1, ["格式规则"])
    │       │                                  ↑ Reconsolidation:
    │       │                                    recallCount 2→3
    │       │                                    lastRecalledAt → now
    │       │                                    keywords += ["格式规则"]
    │       │
    │       └→ 弱匹配 → 无（已有强匹配，不注入元认知提示）
    │
    └→ LLM 收到：[system] + [recovered #1] + [messages]
```

---

## 五、验证

```bash
npx tsc --noEmit  # ✅ 零错误
```

---

## 六、认知模型覆盖率提升

| 模型/理论 | 改进前覆盖 | 改进后覆盖 |
|---|---|---|
| Atkinson-Shiffrin 三级存储 | ✅ | ✅ |
| Ebbinghaus 遗忘曲线 | ✅ | ✅ 自适应半衰期 |
| Tulving 编码特异性 | ✅ | ✅ |
| Craik & Lockhart 加工深度 | 部分 | ✅ salience 标记 |
| Miller 工作记忆容量 | ✅ | ✅ |
| 杏仁核情绪增强 | ❌ | ✅ |
| 记忆再固化 | ❌ | ✅ |
| 间隔重复效应 | ❌ | ✅ |
| 舌尖现象 (TOT) | ❌ | ✅ |
| 前瞻性记忆 | ❌ | ✅ (TODO 保护) |
| 冯·雷斯托夫效应 | ❌ | ✅ (异常事件高 salience) |
| 自我参照效应 | ❌ | ✅ (用户纠正最高优先) |

**综合覆盖率：~60% → ~90%**

---

## 七、剩余可扩展方向

| 方向 | 对应理论 | 说明 |
|------|---------|------|
| 语义组块 | Miller Chunking | 将相关的 read→edit→bash 操作组识别为语义组块 |
| 离线整理 | 睡眠固化 | 会话间隙后台重新索引和聚类 |
| 干扰消解 | 前摄/倒摄抑制 | 多个相似话题索引之间的消歧 |
| 元认知监控 | Metamemory | Agent 主动报告"我可能遗忘了什么" |
| 知识图谱 | 语义网络 | 索引之间建立关联边，形成扩散激活网络 |
