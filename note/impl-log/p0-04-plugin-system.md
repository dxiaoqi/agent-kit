# Step 0.4: Plugin 接口 + PluginManager

## 改动路径

```
新建  src/plugin/types.ts      # Plugin / PluginContext 接口 + 各类注册类型
新建  src/plugin/manager.ts    # PluginManager 实现
```

## 思路

### 问题

当前 agent-kit 的能力（工具、LLM、Prompt）都硬编码在代码中，无法通过配置或第三方扩展。`read.md` 的核心愿景是"像 webpack 一样"通过 plugin 机制扩展能力。

### 方案

**Plugin 是一等公民**——所有能力注入都通过 `Plugin.setup(ctx)` 完成：

```
Plugin.setup(ctx) {
    ctx.registerTool(...)          // 注册工具
    ctx.registerProvider(...)      // 注册 LLM 适配器
    ctx.registerToolRenderer(...)  // 注册 UI 渲染器
    ctx.registerInputMode(...)     // 注册输入模式
    // ... 共 12 种注册 API
}
```

### 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 注册类型定义放哪 | `plugin/types.ts` 用轻量 placeholder | 避免循环依赖（plugin → tool → plugin） |
| 重名处理 | 后注册覆盖 + warn 日志 | 允许插件覆盖内置工具（如自定义 bash） |
| 上下文隔离 | 每个 plugin 独立的 PluginContext 对象 | 未来可做权限隔离（限制某些 plugin 的注册范围） |
| 事件系统 | 简单的 Map<string, handler[]> | 够用，不需要 EventEmitter 的复杂度 |
| UI 插槽 | 6 种注册 API 直接暴露 | 与 `note/09-restructure-plan.md` 的 2.5 节设计对齐 |

### PluginManager 的职责

1. **注册**：接收 Plugin，调用 `setup(ctx)`，收集所有注册项
2. **存储**：各类注册项存在独立的 Map/数组中
3. **查询**：`tools.get(name)` / `toolRenderers.get(name)` 等
4. **生命周期**：`teardownAll()` 按注册逆序清理
5. **事件**：简单的 pub/sub，plugin 可通过 `ctx.on()` 订阅

### 注册表结构

```
PluginManager
├── tools:              Map<name, ToolRegistration>
├── providers:          Map<name, ProviderRegistration>
├── loaders:            LoaderRegistration[]
├── promptModules:      Map<id, PromptModuleRegistration>
├── workflows:          Map<name, WorkflowRegistration>
├── subagentTypes:      Map<name, SubagentTypeRegistration>
├── toolRenderers:      Map<toolName, ToolRendererRegistration>      ← UI 插槽
├── permRenderers:      Map<toolName, PermissionRendererRegistration> ← UI 插槽
├── contentRenderers:   Map<blockType, ContentRendererRegistration>   ← UI 插槽
├── markdownExtensions: MarkdownExtensionRegistration[]               ← UI 插槽
├── inputModes:         Map<name, InputModeRegistration>              ← UI 插槽
└── statusBarItems:     StatusBarItemRegistration[] (sorted)          ← UI 插槽
```

## 效果

### Before

```typescript
// 硬编码：Agent 类内部 stub
protected getToolSchemas(): null { return null; }
protected async executeTools(): Promise<boolean> { return true; }
```

### After

```typescript
// 通过 Plugin 注入
const kernel = new AgentKernel(config);
await kernel.plugins.register(codeToolsPlugin);
await kernel.plugins.register(openaiProviderPlugin);
// → kernel.plugins.tools 已经有了 bash, read_file, ... 
// → kernel.plugins.toolRenderers 已经有了对应的 UI 渲染器
```

## 验证方式

```bash
# 1. 类型检查
npx tsc --noEmit src/plugin/types.ts src/plugin/manager.ts

# 2. 手动验证 Plugin 注册流程
# const pm = new PluginManager({}, console);
# await pm.register({
#     name: "test", version: "0.1.0",
#     setup(ctx) { ctx.registerTool({ name: "echo", ... }); }
# });
# pm.tools.has("echo") === true  ✓
```
