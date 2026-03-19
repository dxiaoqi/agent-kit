# Phase 3：Loader + Workflow + Prompt 动态管理

> 实现日期：2026-03-14

---

## 一、设计目标

实现 agent-kit 框架级的两大能力：

1. **Loader 系统**：统一资源加载抽象，将"读文件"、"读 URL"等操作从工具硬编码中解耦
2. **Workflow 系统**：场景化 Agent 行为编排，通过切换 Workflow 改变 Agent 的 Prompt、工具集、行为模式

## 二、总体架构

```
┌─────────────────────────────────────────────────────────┐
│  config.toml                                            │
│  workflow = "code"                                      │
├───────────┬─────────────────────────────────────────────┤
│           │                                             │
│  ┌────────▼─────────┐    ┌────────────────────────────┐│
│  │ WorkflowManager  │    │ LoaderPipeline              ││
│  │  .activate()     │    │  .register(loader)          ││
│  │  .deactivate()   │    │  .load(resource)            ││
│  │  .list()         │    │  cache by uri + TTL         ││
│  └────────┬─────────┘    └────────────────────────────┘│
│           │                                             │
│  ┌────────▼─────────┐                                   │
│  │ PromptEngine     │                                   │
│  │  .setActiveModules()   ← Workflow 控制               │
│  │  .applyOverrides()     ← Workflow 覆盖               │
│  │  .clearActiveFilter()  ← deactivate 恢复             │
│  │  .build(ctx)           → system prompt               │
│  └──────────────────┘                                   │
│                                                         │
│  /workflow list|code|research|off ← REPL 斜杠命令        │
└─────────────────────────────────────────────────────────┘
```

## 三、文件清单

### Loader 系统

| 文件 | 职责 |
|------|------|
| `src/loader/types.ts` | `LoaderDef` / `ResourceRef` / `LoaderResult` / `LoaderContext` |
| `src/loader/pipeline.ts` | `LoaderPipeline` — 注册、匹配、缓存、加载 |
| `src/loader/loaders/file.ts` | 内置文件 Loader — 二进制检测、大文件截断 |
| `src/loader/loaders/url.ts` | 内置 URL Loader — HTTP fetch、HTML 净化、超时控制 |

### Workflow 系统

| 文件 | 职责 |
|------|------|
| `src/workflow/types.ts` | `WorkflowDef` / `WorkflowContext` |
| `src/workflow/manager.ts` | `WorkflowManager` — 注册、激活、停用、查询 |
| `src/workflow/builtin/code.ts` | `codeWorkflow` — 代码开发模式 |
| `src/workflow/builtin/research.ts` | `researchWorkflow` — 只读调研模式 |

### Prompt 引擎增强

| 文件 | 变更 |
|------|------|
| `src/prompt/engine.ts` | 新增 `setActiveModules` / `applyOverrides` / `clearActiveFilter` / `clearOverrides` |

### 集成

| 文件 | 变更 |
|------|------|
| `src/kernel/agent.ts` | `AgentConfig` 新增 `workflowManager`；`Agent` 暴露 `workflows` getter |
| `src/config/config.ts` | `ConfigSchema` 新增 `workflow` 字段 |
| `src/main.ts` | 创建 `LoaderPipeline` + `WorkflowManager`；按配置激活工作流 |
| `src/ui/screens/REPL.tsx` | 新增 `/workflow` 斜杠命令 |
| `.agent/config.toml` | 新增 `workflow` 配置项 |

## 四、Loader 设计

### 4.1 ResourceRef

```typescript
interface ResourceRef {
    type: "file" | "url" | "db" | "api" | "custom";
    uri: string;
    metadata?: Record<string, unknown>;
}
```

### 4.2 LoaderDef

```typescript
interface LoaderDef {
    name: string;
    test: RegExp | ((resource: ResourceRef) => boolean);
    load(resource: ResourceRef, ctx: LoaderContext): Promise<LoaderResult>;
}
```

### 4.3 LoaderPipeline

- 按注册顺序遍历 loaders，找到第一个 `test` 匹配的
- 内存缓存（key = `type:uri`），尊重 `cacheable` 和 `ttl`
- 文件 loader：二进制扩展检测、512KB 截断
- URL loader：15s 超时、256KB 截断、HTML 标签剥离

## 五、Workflow 设计

### 5.1 WorkflowDef

```typescript
interface WorkflowDef {
    name: string;
    description: string;
    requiredTools: string[];       // 启动时校验
    promptModules: string[];       // 激活哪些 PromptModule
    promptOverrides?: Record<string, string>;  // 按模块 id 覆盖内容
    extraContext?: Record<string, string>;
    onActivate?(ctx: WorkflowContext): void | Promise<void>;
    onDeactivate?(): void | Promise<void>;
}
```

### 5.2 激活流程

```
/workflow code
  → WorkflowManager.activate("code")
    → 1. deactivate current workflow
    → 2. check requiredTools vs ToolRegistry
    → 3. PromptEngine.setActiveModules(promptModules)
    → 4. PromptEngine.applyOverrides(promptOverrides)
    → 5. call onActivate hook
```

### 5.3 内置工作流

| Workflow | 描述 | 工具 | Prompt 覆盖 |
|----------|------|------|-------------|
| `code` | 代码开发（Claude Code 模式）| bash, read/write/edit_file, glob, grep | 无 |
| `research` | 只读调研/分析 | read_file, glob, grep | identity → 分析师身份；behavior → 禁止写操作 |

### 5.4 PromptEngine 增强

| 方法 | 作用 |
|------|------|
| `setActiveModules(ids)` | 只 build 指定 id 的模块 |
| `clearActiveFilter()` | 恢复为全部模块 |
| `applyOverrides(map)` | 按 id 替换模块输出 |
| `clearOverrides()` | 清除所有覆盖 |

### 5.5 REPL 命令

```
/workflow         → 列出所有工作流
/workflow list    → 同上
/workflow code    → 激活 code 工作流
/workflow off     → 停用当前工作流
```

## 六、配置

```toml
# .agent/config.toml
workflow = "code"    # 启动时激活（可选）
```

## 七、验证

```bash
npx tsc --noEmit     # ✅ 零错误
```
