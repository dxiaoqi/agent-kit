# Phase 2.6：Todo 工具（外部记忆）

> 实现日期：2026-03-14

---

## 一、设计目标

为 Agent 提供**结构化任务管理**能力——作为"外部记忆"跨轮次持久，帮助 Agent 在复杂多步任务中保持进度感知。

对标 Claude Code 的 `TodoWrite` 工具：Agent 可以在对话过程中创建、更新、合并任务列表，每个任务有 id、内容、状态。

## 二、架构

```
┌──────────────────────────────────────────┐
│  todo_write                              │
│  创建/更新/替换 TODO 列表                  │
│  merge=true → 按 id 合并                  │
│  merge=false → 全量替换                   │
└──────────┬───────────────────────────────┘
           │
    ┌──────▼──────┐
    │  TodoStore  │ ← 会话级单例（内存）
    │  (singleton)│
    └──────▲──────┘
           │
┌──────────┴───────────────────────────────┐
│  todo_read                               │
│  读取 TODO 列表                           │
│  支持按 status 过滤                       │
└──────────────────────────────────────────┘
```

## 三、文件清单

| 文件 | 职责 |
|------|------|
| `src/tool/builtin/todo_store.ts` | `TodoStore` 单例 — 纯内存存储 |
| `src/tool/builtin/todo_write.ts` | `todo_write` 工具定义 |
| `src/tool/builtin/todo_read.ts` | `todo_read` 工具定义 |
| `src/tool/builtin/index.ts` | 新增导出 |
| `src/plugin/builtin.ts` | 注册到内置插件 |

## 四、接口设计

### 4.1 TodoItem

```typescript
interface TodoItem {
    id: string;
    content: string;
    status: "pending" | "in_progress" | "completed" | "cancelled";
}
```

### 4.2 todo_write

```typescript
// 输入
{
    todos: TodoItem[];   // 至少 1 个
    merge: boolean;      // true: 按 id 合并; false: 全量替换
}

// 输出
"TODO: 5 items (1 in progress, 3 pending, 1 completed)\n  ◐ task-1: ...\n  ○ task-2: ..."
```

**合并语义**（`merge=true`）：
- 已有 id → 更新提供的字段（content / status）
- 新 id → 追加
- 未提及的 id → 保留不动

**替换语义**（`merge=false`）：
- 直接替换整个列表

### 4.3 todo_read

```typescript
// 输入
{
    status?: "pending" | "in_progress" | "completed" | "cancelled" | "all";
    // 默认 "all"
}

// 输出
"TODO List — 5 item(s):\n○ [task-1] Write tests (pending)\n◐ [task-2] Implement feature (in_progress)"
```

### 4.4 状态图标

| 状态 | 图标 |
|------|------|
| pending | ○ |
| in_progress | ◐ |
| completed | ● |
| cancelled | ✕ |

## 五、TodoStore 设计

- **单例模式**：`TodoStore.instance`
- **纯内存**：不做文件持久化，会话结束即清空
- **方法**：
  - `replace(todos)` — 全量替换
  - `merge(updates)` — 按 id 合并
  - `getAll()` — 获取全部
  - `getByStatus(status)` — 按状态过滤
  - `getSummary()` — 生成摘要文本
  - `clear()` — 清空

## 六、Prompt 设计要点

`todo_write` 的 description 包含使用指导：
- 鼓励 `merge=true` 做增量更新
- 建议同时只有一个 `in_progress` 任务
- 完成后立即标记 `completed`

`todo_read` 的 description 说明过滤能力，引导 Agent 在新轮次开始时检查进度。

## 七、验证

```bash
npx tsc --noEmit     # ✅ 零错误
```
