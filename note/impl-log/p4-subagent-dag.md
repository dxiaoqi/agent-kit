# Phase 4：Subagent DAG 实现日志

## 一、设计目标

实现子代理 DAG 图管理机制：

1. **DAG 数据结构**——节点是独立 Agent 实例，边是数据依赖
2. **拓扑排序 + 分层并发**——同层节点 `Promise.allSettled` 并行执行
3. **节点间通信**——MessageBus 发布/订阅 + 存储
4. **上下文隔离**——`ContextManager.fork()` 创建独立子上下文
5. **后台任务**——`BackgroundTaskManager` 管理异步执行的子代理
6. **用户工具**——`task` 和 `task_output` 工具让 Agent 自主启动/查询子任务

## 二、架构概览

```
┌──────────────────────────────────────────────────────┐
│  Parent Agent                                        │
│  ┌──────────┐   ┌──────────────┐                     │
│  │ task tool │──▶│ SubagentRunner│──▶ fork Context   │
│  └──────────┘   │  (isolated)   │    独立消息列表     │
│                 └──────┬───────┘                     │
│                        │                              │
│  ┌──────────────┐      │      ┌──────────────────┐   │
│  │BackgroundTask│◀─────┘      │  DAGScheduler    │   │
│  │   Manager    │             │  拓扑排序 + 并发  │   │
│  └──────────────┘             │  ┌────┐ ┌────┐   │   │
│  ┌──────────────┐             │  │Node│→│Node│   │   │
│  │ task_output  │             │  └────┘ └────┘   │   │
│  │   tool       │             │       ↘  ↙       │   │
│  └──────────────┘             │      ┌────┐      │   │
│                               │      │Node│      │   │
│                               │      └────┘      │   │
│                               └──────────────────┘   │
│                                       ↕               │
│                               ┌──────────────┐       │
│                               │  MessageBus  │       │
│                               │  pub/sub+store│      │
│                               └──────────────┘       │
└──────────────────────────────────────────────────────┘
```

## 三、文件清单

| 文件 | 职责 | 行数 |
|------|------|------|
| `src/subagent/types.ts` | DAG 图定义、NodeResult、BusMessage 类型 | ~95 |
| `src/subagent/bus.ts` | MessageBus 发布/订阅 + 消息存储 | ~50 |
| `src/subagent/runner.ts` | SubagentRunner 单子代理执行器 | ~120 |
| `src/subagent/scheduler.ts` | DAGScheduler 拓扑排序 + 分层并发调度 | ~200 |
| `src/subagent/background.ts` | BackgroundTaskManager 后台任务管理 | ~80 |
| `src/subagent/index.ts` | 汇总导出 | ~6 |
| `src/tool/builtin/task.ts` | `task` 工具（启动子代理） | ~100 |
| `src/tool/builtin/task_output.ts` | `task_output` 工具（查询任务结果） | ~85 |
| `src/context/manager.ts` | 新增 `fork()` 方法 | +15 |
| `src/kernel/events.ts` | 新增 `task_start` / `task_complete` 事件 | +20 |
| `src/main.ts` | 集成 BackgroundTaskManager + 注入依赖 | +15 |
| `src/plugin/builtin.ts` | 注册 task / task_output 工具 | +4 |
| `src/tool/builtin/index.ts` | 导出 task 工具 | +2 |

## 四、核心设计

### 4.1 DAG 数据结构

```typescript
interface DAGDef {
    nodes: DAGNode[];  // 节点 = 子代理
    edges: DAGEdge[];  // 边 = 数据依赖
}

interface DAGNode {
    id: string;
    type: string;       // 子代理类型
    goal: string;       // 目标 prompt
    config?: DAGNodeConfig;  // 工具限制、最大轮次、只读模式
}

interface DAGEdge {
    from: string;
    to: string;
    condition?: string;  // 可选条件："success" | "failure" | "contains:keyword"
}
```

### 4.2 DAGScheduler 调度策略

1. **验证**——检查节点 ID 引用合法性 + 环检测
2. **分层**——BFS 拓扑排序，入度为 0 的节点为同一层
3. **执行**——同层 `Promise.allSettled` 并发
4. **传播**——完成节点通过 MessageBus 推送结果给下游
5. **失败处理**——上游失败则下游标记 `skipped`
6. **条件边**——`evaluateCondition()` 过滤不满足条件的数据传递

### 4.3 SubagentRunner 执行模型

```
Parent Agent
    │
    ├─▶ SubagentRunner.run(upstreamMessages)
    │       │
    │       ├── buildToolRegistry()  ← 工具白名单过滤 / readOnly 过滤
    │       ├── buildSystemPrompt()  ← 注入目标 + 上游结果
    │       ├── new Agent(config, llm, scopedTools)
    │       ├── for await (event of agent.run(goal))
    │       │       └── 收集输出文本 + token 统计
    │       └── return NodeResult { status, output, durationMs, tokenUsage }
    │
    └── (结果通过 MessageBus 传给下游)
```

关键隔离机制：
- **ContextManager.fork()**：独立消息列表、token 追踪、compact 索引
- **ToolRegistry 子集**：`allowedTools` 白名单或 `readOnly` 过滤
- **独立 Agent 实例**：不共享父 Agent 的对话历史

### 4.4 MessageBus

简单的 pub/sub + 存储模型：
- `publish(msg)` → 存储 + 通知订阅者
- `collectInputs(nodeId)` → 收集发给该节点的数据消息
- `subscribe(nodeId, handler)` → 返回取消函数

### 4.5 BackgroundTaskManager

管理异步执行的子代理任务：
- `create(goal)` → 返回 `BackgroundTask { id, goal, status: "running" }`
- `complete(id, result)` → 标记完成/失败
- `getSummary()` → 格式化任务列表（含状态图标和耗时）

### 4.6 Task 工具

Agent 通过 `task` 工具自主决定何时启动子代理：

```typescript
// 前台执行（等待完成）
task({
    description: "Refactor auth module",
    prompt: "Analyze and refactor the authentication module...",
    allowedTools: ["read_file", "write_file", "edit_file", "bash"],
    maxTurns: 30,
})

// 后台执行（立即返回 task ID）
task({
    description: "Generate tests",
    prompt: "Write unit tests for...",
    background: true,
})

// 稍后查询
task_output({ taskId: "task-1" })
```

### 4.7 事件扩展

新增两个事件类型用于 UI 层展示：
- `task_start` { taskId, goal, background }
- `task_complete` { taskId, success, durationMs }

## 五、验证

```
$ npx tsc --noEmit    # ✓ 零错误
$ npx eslint src/subagent/  # ✓ 无 lint 问题
```

## 六、与 Phase 3 的集成点

| Phase 3 模块 | 集成方式 |
|-------------|---------|
| WorkflowManager | 工作流可通过 `requiredTools` 包含/排除 `task` 工具 |
| LoaderPipeline | 子代理继承父 Agent 的 loader（通过共享 ToolRegistry） |
| PromptEngine | 子代理使用独立的 system prompt（由 Runner 构建） |

## 七、设计决策

1. **依赖注入而非单例**：`injectTaskDeps()` 在 bootstrap 时注入，避免循环依赖
2. **条件边简单化**：仅支持 `success` / `failure` / `contains:` 三种条件，不引入表达式引擎
3. **fork 而非 share**：子代理 context 完全独立，不与父级共享 compact 索引，避免并发污染
4. **后台任务 fire-and-forget**：后台任务完成后通过 `task_output` 拉取结果，不主动推送
