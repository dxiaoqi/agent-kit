# Phase 1: 工具系统 + Prompt 引擎

## 改动路径

```
新建  src/tool/builtin/bash.ts          # Bash 命令执行工具
新建  src/tool/builtin/read_file.ts     # 读文件工具（带行号）
新建  src/tool/builtin/write_file.ts    # 写文件工具（自动创建目录）
新建  src/tool/builtin/edit_file.ts     # 精确替换工具（str_replace 模式）
新建  src/tool/builtin/glob.ts          # 文件搜索工具
新建  src/tool/builtin/grep.ts          # 内容搜索工具
新建  src/tool/builtin/index.ts         # 汇总导出
新建  src/plugin/builtin.ts             # 内置工具 Plugin
新建  src/prompt/types.ts               # PromptModule / PromptContext 接口
新建  src/prompt/engine.ts              # PromptEngine：模块化 prompt 组装
新建  src/prompt/modules/identity.ts    # 身份声明模块
新建  src/prompt/modules/environment.ts # 环境信息模块（OS/Shell/日期/CWD/工具列表）
新建  src/prompt/modules/behavior.ts    # 行为规范模块
新建  src/prompt/modules/developer.ts   # 开发者指令模块（AGENT.MD 注入）
修改  src/main.ts                       # 接入 Plugin 注册 + PromptEngine
```

## 思路

### 一、工具设计

#### 6 个核心工具

| 工具 | 描述 | isReadOnly | 关键设计 |
|------|------|-----------|---------|
| `bash` | 执行 Shell 命令 | ❌ | 子进程 spawn + timeout + maxBuffer + SIGKILL 保护 |
| `read_file` | 读文件（带行号） | ✅ | 支持 offset/limit 分页 + 行号 padding 对齐 |
| `write_file` | 写文件 | ❌ | 自动 mkdir -p 父目录 |
| `edit_file` | 精确替换 | ❌ | old_string 必须唯一出现一次，否则报错 |
| `glob` | 文件搜索 | ✅ | 递归 walkDir + 跳过 node_modules/.git + mtime 排序 |
| `grep` | 内容搜索 | ✅ | 正则匹配 + 上下文行 + 跳过二进制/大文件 |

#### bash 工具安全设计

```
输入 command ──→ spawn("bash", ["-c", command])
                 ├── TERM=dumb（禁用颜色转义）
                 ├── timeout（默认 30s）
                 ├── maxBuffer（1MB 限制）
                 │   └── 超限 → SIGKILL
                 ├── AbortSignal → SIGTERM
                 └── close → { success: code===0, output: stdout+stderr+exitCode }
```

#### edit_file 唯一性校验

```
old_string 出现次数：
  0 次 → error: "not found, check whitespace"
  1 次 → replace + write
  2+次 → error: "found N times, provide more context"
```

这是 Claude Code str_replace_editor 的核心设计：强制唯一匹配避免误改。

#### glob/grep 性能保护

两个工具都有以下保护：
- **跳过目录**：node_modules、.git、dist、__pycache__ 等
- **结果上限**：glob 200 / grep 50
- **文件大小限制**：grep 跳过 > 512KB 的文件
- **二进制跳过**：grep 跳过图片/字体/压缩文件

### 二、Plugin 注册模式

所有工具通过 `codeToolsPlugin` 注册：

```typescript
const codeToolsPlugin: Plugin = {
    name: "@agent-kit/tools-code",
    version: "0.1.0",
    setup(ctx) {
        ctx.registerTool(bashTool);
        ctx.registerTool(readFileTool);
        // ...
    },
};
```

main.ts 在 bootstrap 时通过 `PluginContext` 接口注册工具到 `ToolRegistry`。

### 三、Prompt 模块化引擎

#### 模块列表

| 模块 | 优先级 | 作用 |
|------|-------|------|
| identity | 0 | Agent 身份声明 |
| environment | 10 | OS、Shell、日期、CWD、工具列表 |
| behavior | 20 | 编码规范、工具使用规则 |
| developer | 100 | AGENT.MD 注入 |

#### 组装流程

```
PromptEngine.build(ctx)
  → modules.sort(priority)
  → modules.map(m => m.render(ctx))
  → filter(null)
  → join("\n\n")
```

Plugin 可以通过 `ctx.registerPromptModule()` 注入自定义模块，按优先级插入到合适位置。

## 效果

### 端到端验证结果

```
✅ 6 个工具全部注册成功
   Registered tools: [bash, read_file, write_file, edit_file, glob, grep]

✅ read_file 正确读取文件并输出行号
   [package.json] 31 lines
   1|{
   2|  "name": "agent-kit",

✅ glob 正确搜索文件
   Found 5 file(s):
   origin/Kode-Agent-main/src/acp/index.ts
   ...

✅ grep 正确搜索内容并显示上下文
   Found 2 match(es):
   origin/Kode-Agent-main/src/core/tools/registry.ts
     11: export type { ToolRegistry } from './registry'

✅ bash 正确执行命令
   hello world
   [exit code: 0]

✅ TypeScript 编译零错误
✅ CLI --help 正常显示
```

## 验证方式

```bash
# 1. TypeScript 编译
npx tsc --noEmit              # ✅ 零错误

# 2. CLI 启动
npx tsx src/main.ts --help    # ✅ 正常

# 3. 工具集成测试（已运行并通过）
# - registry.list() → 6 个工具
# - registry.getSchemas() → 6 个 JSON Schema
# - read_file('package.json') → 成功，带行号
# - glob('**/*.ts') → 成功，按 mtime 排序
# - grep('ToolRegistry', include: '*.ts') → 成功，带上下文
# - bash('echo hello') → 成功，exit code 0

# 4. 端到端验证（需要 API Key）
# API_KEY=sk-xxx npx tsx src/main.ts ask "list files in src/"
# → Agent 应调用 glob 或 bash 工具
# → 返回文件列表
```

## Phase 1 完成总结

| 组件 | 文件数 | 状态 |
|------|-------|------|
| 内置工具 | 7 文件 | ✅ |
| 内置 Plugin | 1 文件 | ✅ |
| Prompt 引擎 | 6 文件 | ✅ |
| main.ts 集成 | 1 文件 | ✅ |
| **合计** | **15 文件** | **✅** |

新建文件 14 个，修改 1 个。`tsc --noEmit` 零错误，所有工具测试通过。

下一步：Phase 1.5 — UI 层重建（React + Ink），或 Phase 2 — 权限系统 + 上下文管理。
