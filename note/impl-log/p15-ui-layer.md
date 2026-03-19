# Phase 1.5: UI 层重建（React + Ink）

## 改动路径

```
安装  ink@^5.1.0, react@^18.3.1, @types/react@^18.3.0
安装  cli-highlight, marked, wrap-ansi, figures, ansi-escapes

新建  src/ui/theme.ts                          # 主题系统（dark/light）
新建  src/ui/slots.ts                          # 六种 UI 插槽类型定义
新建  src/ui/registry.ts                       # UIRegistry：插槽注册表
新建  src/ui/app.tsx                           # Ink render 入口 + UIContext Provider
新建  src/ui/hooks/use-registry.ts             # UIContext + useTheme/useRegistry hooks
新建  src/ui/hooks/use-text-input.ts           # 文本输入 hook（光标/多行/快捷键）
新建  src/ui/hooks/use-agent.ts                # Agent 生命周期 hook（事件消费/消息管理）
新建  src/ui/components/Spinner.tsx            # 处理中动画（✻ + 随机动词 + 计时）
新建  src/ui/components/Truncate.tsx           # 长输出截断（首25行 + 尾25行）
新建  src/ui/components/Select.tsx             # 键盘上下选择器
新建  src/ui/components/Logo.tsx               # 启动横幅
新建  src/ui/components/Markdown.tsx           # Markdown 终端渲染（代码块/列表/行内样式）
新建  src/ui/components/PromptInput.tsx        # 输入框（圆角边框 + 模型标签）
新建  src/ui/components/StatusBar.tsx          # 底部状态栏（token/cost + 插槽项）
新建  src/ui/messages/AssistantText.tsx        # Assistant 文本 → Markdown
新建  src/ui/messages/ToolUse.tsx              # 工具调用（⏺ + 插槽渲染）
新建  src/ui/messages/ToolResult.tsx           # 工具结果（⎿ + 插槽渲染 + 截断）
新建  src/ui/messages/ToolError.tsx            # 工具错误（红色 + 截断10行）
新建  src/ui/messages/SystemNotice.tsx         # 系统通知（info/warning/error）
新建  src/ui/permissions/PermissionDialog.tsx  # 权限框（圆角 + 风险着色 + 选项）
新建  src/ui/permissions/FallbackPermission.tsx # 无自定义渲染器的兜底
新建  src/ui/screens/REPL.tsx                  # 主 REPL 屏幕（Static + Transient）
修改  src/main.ts                              # chat → Ink, ask → plain text
修改  src/plugin/types.ts                      # ReactNode 改为真实 React 类型
```

## 思路

### 一、架构设计

UI 层采用 **React + Ink** 架构，复刻 Claude Code 的终端交互模式：

```
startApp()
  └── <UIContext.Provider value={{ registry, theme }}>
        └── <REPL>
              ├── <Static items={staticPrefix}>      ← 已稳定历史：固定在滚动历史
              │     └── <MessageRenderer>
              ├── {transientTail.map(MessageRenderer)} ← 未完成尾部：实时更新
              └── <BottomPanel>
                    ├── <Spinner>                      ← 首 token 前显示
                    ├── <PromptInput>                  ← 本轮结束后显示
                    └── <StatusBar>                    ← 本轮结束后显示
```

### 二、核心设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| UI 框架 | Ink (React for CLI) | 组件化 + 声明式 + 复用 React 生态 |
| 布局策略 | Static Prefix + Transient Tail | 只让最后一段未完成内容重绘，减少 Ink 擦除错位 |
| 主题系统 | 接口 + 预设（dark/light） | 通过 Context 传递，组件不硬编码颜色 |
| 插槽注册 | UIRegistry + React Context | 组件用 useRegistry() 查找插槽 |
| 输入管理 | 自定义 useTextInput hook | Ink 的内置 input 功能有限，需要光标/多行/快捷键 |
| 消息状态 | useAgent hook | 封装事件消费 + 消息管理 + loading 状态 |

### 三、六种 UI 插槽

| 插槽类型 | 注册键 | 查找方式 | 渲染位置 |
|---------|--------|---------|---------|
| ToolRenderer | toolName | `registry.getToolRenderer(name)` | ToolUse.tsx / ToolResult.tsx |
| PermissionRenderer | toolName | `registry.getPermissionRenderer(name)` | PermissionDialog.tsx |
| ContentRenderer | blockType | `registry.getContentRenderer(type)` | ContentBlock.tsx |
| MarkdownExtension | name | `registry.getMarkdownExtensions()` | Markdown.tsx |
| InputMode | name | `registry.getInputModes()` | PromptInput.tsx |
| StatusBarItem | id | `registry.getStatusBarItems()` | StatusBar.tsx |

Plugin 通过 `ctx.registerToolRenderer(...)` 等 API 注册到 UIRegistry。

### 四、消息渲染流程

```
AgentEvent 到达
  │
  ├── text_delta → 更新最后一条未完成 assistant_text
  ├── text_complete → 标记该消息 completed=true
  ├── tool_call_start → append tool_use(completed=false)
  ├── tool_call_complete → tool_use.completed=true + append ToolResult
  ├── tool_call_error → tool_use.completed=true + append ToolError
  └── agent_error → append SystemNotice
```

`useAgent` 内部只维护一个 `items` 数组。`REPL` 按第一个 `completed=false` 的位置切出：
- `staticPrefix`: 已稳定内容，交给 `<Static>`
- `transientTail`: 仍可能变化的尾部内容，直接渲染

这样既保留了单一消息源，又维持了 Ink 需要的稳定重绘边界。

### 五、Markdown 渲染

自实现的简易块级解析器，支持：
- 标题（#～######）
- 围栏代码块（```lang ... ```）
- 有序/无序列表
- 引用（> ...）
- 分隔线（---）
- 行内：**bold** / *italic* / `code`
- 扩展插槽：MarkdownExtension.pattern 匹配 → parse → render

### 六、权限对话框

复刻 Claude Code 的审批框：
- 圆角边框（`borderStyle="round"`）
- 风险着色：high=红/moderate=黄/low=蓝
- 插槽渲染：PermissionRenderer 自定义工具信息展示
- 选项：键盘上下选择 → allow / always / deny

### 七、输入框

- 圆角边框 + 模型标签 + 光标
- 多行支持：Option+Enter 换行
- 快捷键：Ctrl+A（行首）/ Ctrl+E（行尾）/ Ctrl+U（清行）
- disabled 状态（loading 时变灰）

### 八、实现补充笔记

#### 1. 单一消息源 + 渲染分层

消息状态最终采用“单一 `items` 数组 + 分层渲染”的方式，而不是维护两套独立消息源。

这样做的原因：

- 状态层只关心消息生命周期，逻辑简单
- 渲染层再根据 `completed` 与消息类型切出 `staticPrefix` 和 `transientTail`
- 可以把 Ink 的“稳定历史”和“可变尾部”问题留在 UI 层解决，而不是把状态模型搞复杂

经验上，终端 UI 更适合：

- `state` 保持单一事实来源
- `render` 决定哪些内容应当进入 `<Static>`

#### 2. 为什么工具项不直接进入 Static

工具结果支持折叠/展开后，工具消息就不再是完全静态内容。

如果工具项一旦执行完就进入 `<Static>`：

- 终端历史会被直接落盘
- 后续无法再响应展开/折叠
- 也无法做选中态和局部交互

因此最终策略是：

- 普通已完成文本消息可以进入 `Static`
- 工具项即使完成，也保留在可更新区域
- 用颜色和折叠态减少视觉噪音，而不是强行把它们静态化

#### 3. 工具折叠设计

工具调用最终收敛成“一条工具消息”：

- 上半行显示工具名、参数、状态点
- 下半行挂工具结果预览
- 折叠态只显示首行 + `...`
- 展开态显示完整输出

这样比“tool_use + tool_result 两条独立消息”更适合终端 UI：

- 视觉上更像一个完整的操作块
- 折叠/展开只影响当前工具，不会打散消息流
- 结果和调用天然绑定，不需要用户脑内配对

#### 4. 工具状态色的语义

工具前面的状态点颜色统一为：

- 黄色：执行中
- 绿色：执行成功
- 红色：执行失败

这里不沿用原来的 `toolPending/toolResult` 配色，而是直接映射到更明确的语义色。
原因是终端中工具调用通常是高频信息，颜色应该优先表达“状态”，而不是表达“组件类型”。

#### 5. 工具展开交互的最小实现

折叠交互没有引入完整的焦点系统，而是采用最小可用方案：

- `Ctrl+N` / `Ctrl+P` 在可折叠工具项之间切换
- `Ctrl+O` 展开或折叠当前选中的工具项

这样做的好处：

- 不需要重写输入框焦点管理
- 不和现有文本输入的普通键位冲突
- 能先验证“折叠式工具消息”是否适合当前 CLI

如果后面要继续增强，可以再考虑：

- 可视化的 message cursor
- 统一的列表导航
- 回车展开
- 更细的 tool block 交互模型

## 效果

### Before

```
旧 TUI（readline）：
  - 纯文本输入/输出
  - 无颜色主题
  - 无工具执行动画
  - 无 Markdown 渲染
  - 无权限对话框
  - 无插槽扩展
```

### After

```
新 Ink UI：
  - React 组件化渲染
  - dark/light 主题
  - ⏺ 工具启动 → ✻ 处理中动画 → ⎿ 结果展示
  - Markdown 代码高亮 + bold/italic/code
  - 权限审批框（圆角边框 + 风险着色 + 键盘选择）
  - 6 种 UI 插槽供 Plugin 扩展
  - Static Prefix + Transient Tail 布局（流式阶段不重复落盘）
  - 底部状态栏（token/cost + 自定义项）
```

## 异常记录：流式输出重复换行

### 现象

在 Ink REPL 中，assistant 流式输出时会出现以下异常：

- 每次 `text_delta` 到达都会把当前累积文本重新打印成新行
- 中文长句时更明显，常见为前几段内容重复落盘
- 回复结束后，底部 spinner、状态栏文案（如 `ESC to interrupt`）也会出现重复刷新

典型现象：

```text
你好！这是一个本地 mock
你好！这是一个本地 mock 流式响应，用来验证
你好！这是一个本地 mock
...
```

### 排查结论

问题不在模型返回，而在 Ink 的重绘边界：

1. 去掉真实模型后，使用本地 mock 流式分块仍可稳定复现。
2. 完全取消 `Static` 改为整棵消息树重绘后，连用户输入都会重复打印，说明终端历史被反复重画。
3. 保留 `Static` 后，如果流式阶段同时渲染 spinner、输入框、状态栏、结尾空行，Ink 会更容易在擦除旧内容时算错范围。
4. 中文自动换行会放大这个问题，因此流式阶段不能过度依赖复杂布局和自动软换行。

### 根因

根因可以概括为两点：

- `transient` 区域过大，流式文本与底部面板一起重绘，导致 Ink 无法稳定擦除旧帧
- loading 结束前后又重新挂载 spinner / status bar，使终端底部区域发生额外跳动

### 最终处理方式

最终保留的修复方案：

1. `useAgent` 改为单一 `items` 消息列表，避免维护两套消息源。
2. `REPL` 根据第一个 `completed=false` 的位置拆成 `staticPrefix + transientTail`。
3. 流式期间只渲染：
   - 已稳定历史
   - 当前未完成消息尾部
4. 底部 `PromptInput`、`StatusBar`、`Newline` 仅在 `!isLoading` 后显示。
5. spinner 仅在“首个 token 到来之前”显示，收到文本后本轮不再重新挂载。
6. 流式中的 assistant 文本使用更轻量的渲染路径，减少自动换行和复杂子树对重绘的影响。

### 不建议的处理方式

- 不建议彻底移除 `Static`
  因为整棵消息树会随任意 state 更新被重绘，历史内容容易重复输出。

- 不建议让底部状态栏在 loading 期间持续显示
  它会和 spinner、streaming text 共同参与重排，增加终端擦除错位概率。

## 验证方式

```bash
# 1. TypeScript 编译零错误
npx tsc --noEmit   # ✅

# 2. CLI 启动正常
npx tsx src/main.ts --help   # ✅

# 3. 交互模式启动（需要 API Key）
# API_KEY=sk-xxx npx tsx src/main.ts chat
# → 应显示 Logo 横幅
# → 应显示输入框（圆角边框）
# → 输入文字后应看到流式文本稳定输出，不应重复落成新行
# → 工具调用应显示 ⏺ → ⎿ 格式

# 4. 单次模式（纯文本输出）
# API_KEY=sk-xxx npx tsx src/main.ts ask "hello"
# → 应直接输出文本到 stdout
```

## Phase 1.5 完成总结

| 类别 | 文件数 |
|------|-------|
| 主题 + 插槽 | 3 |
| Hooks | 3 |
| 基础组件 | 6 |
| 消息组件 | 5 |
| 权限组件 | 2 |
| 屏幕 + 入口 | 2 |
| 修改 | 2 |
| **合计** | **23 文件** |

新建 21 文件 + 修改 2 文件。`tsc --noEmit` 零错误。
交互模式使用 Ink 渲染，单次模式使用纯文本输出。

下一步：Phase 2 — 权限系统 + 上下文管理（压缩、token 追踪）。
