# agent-kit 使用教程

> 从单点功能到组合场景，让 agent-kit 成为你的生产力工具。

---

## 目录

1. [快速开始](#1-快速开始)
2. [基础功能](#2-基础功能)
   - 2.1 [交互式对话](#21-交互式对话)
   - 2.2 [文件操作](#22-文件操作)
   - 2.3 [Shell 命令](#23-shell-命令)
   - 2.4 [代码搜索](#24-代码搜索)
3. [安全与权限](#3-安全与权限)
   - 3.1 [权限模式](#31-权限模式)
   - 3.2 [权限规则](#32-权限规则)
   - 3.3 [沙箱隔离](#33-沙箱隔离)
4. [多模型配置](#4-多模型配置)
   - 4.1 [模型 Profile](#41-模型-profile)
   - 4.2 [角色绑定](#42-角色绑定)
   - 4.3 [费用追踪](#43-费用追踪)
5. [上下文管理](#5-上下文管理)
   - 5.1 [自动压缩](#51-自动压缩)
   - 5.2 [话题召回](#52-话题召回)
   - 5.3 [会话日志](#53-会话日志)
6. [任务系统](#6-任务系统)
   - 6.1 [Todo 工具](#61-todo-工具)
   - 6.2 [子代理 Task](#62-子代理-task)
   - 6.3 [后台任务](#63-后台任务)
7. [扩展能力](#7-扩展能力)
   - 7.1 [MCP 服务器](#71-mcp-服务器)
   - 7.2 [Skill 技能](#72-skill-技能)
   - 7.3 [Workflow 工作流](#73-workflow-工作流)
8. [组合场景](#8-组合场景)
   - 8.1 [全栈项目开发](#81-全栈项目开发)
   - 8.2 [遗留代码重构](#82-遗留代码重构)
   - 8.3 [安全代码审计](#83-安全代码审计)
   - 8.4 [多仓库自动化](#84-多仓库自动化)
   - 8.5 [研究 + 实现 Pipeline](#85-研究--实现-pipeline)
9. [配置参考](#9-配置参考)

---

## 1. 快速开始

### 安装

```bash
git clone <repo-url> && cd agent-kit
npm install
```

### 配置

```bash
cp .env.example .env
# 编辑 .env，填入你的 API Key
```

或在 `.agent/config.toml` 中直接配置：

```toml
[models.default]
name    = "gpt-4o-mini"
apiKey  = "sk-xxx"
baseUrl = "https://api.openai.com/v1"
```

### 启动

```bash
# 交互式对话
npm run dev

# 单次提问
npx tsx src/main.ts ask "列出 src/ 目录结构"

# 构建后使用
npm run build && node dist/main.js
```

---

## 2. 基础功能

### 2.1 交互式对话

启动后进入 REPL 界面，直接输入自然语言即可。

**快捷键：**

| 快捷键 | 功能 |
|--------|------|
| `Option + Enter` | 输入框内换行（多行输入） |
| `Ctrl + C` | 中止当前操作 / 退出 |
| `Ctrl + P / N` | 工具调用上下滚动 |
| `Ctrl + O` | 展开 / 折叠工具输出 |

**Slash 命令：**

| 命令 | 功能 |
|------|------|
| `/help` | 显示所有命令和快捷键 |
| `/status` | 查看上下文统计（token、消息数、压缩次数、追踪文件） |
| `/compact` | 手动触发上下文压缩 |
| `/mode` | 切换权限模式（default → acceptEdits → plan → bypassPermissions） |
| `/cost` | 查看本次会话的费用统计 |
| `/workflow list` | 列出可用工作流 |
| `/workflow code` | 激活 code 工作流 |
| `/workflow off` | 关闭当前工作流 |
| `/exit` | 退出 |

### 2.2 文件操作

agent-kit 内置三种文件工具：

**读取文件** — 支持按行范围读取大文件：

```
请读取 src/main.ts 的前 50 行
```

**写入文件** — 创建新文件或完全覆写：

```
创建一个 utils/logger.ts 文件，实现一个简单的日志工具
```

**精确编辑** — 精确字符串替换（不会影响未改动部分）：

```
把 src/config.ts 里的 timeout: 30000 改成 timeout: 60000
```

### 2.3 Shell 命令

通过 `bash` 工具执行任意 shell 命令：

```
运行 npm test 看测试结果
帮我安装 lodash 依赖
执行 git status 看看有哪些改动
```

沙箱启用时，安全命令（如 `ls`、`cat`、`git status`、`npm install`）会自动在沙箱中执行，无需手动审批。

### 2.4 代码搜索

**Glob** — 按文件名模式查找：

```
找到所有 *.test.ts 文件
```

**Grep** — 按内容正则搜索：

```
搜索代码中所有使用了 console.error 的地方
```

---

## 3. 安全与权限

### 3.1 权限模式

在 `config.toml` 中设置默认行为，运行时可通过 `/mode` 切换：

```toml
approval = "confirm"     # auto | confirm | deny
```

| 模式 | 读操作 | 写操作 | 适用场景 |
|------|--------|--------|---------|
| `default` | ✅ 自动 | ❓ 逐次审批 | 日常使用 |
| `acceptEdits` | ✅ 自动 | ✅ 文件编辑自动 | 大量编码时 |
| `plan` | ✅ 自动 | ❌ 全部拒绝 | 只想看方案不改代码 |
| `bypassPermissions` | ✅ 自动 | ✅ 全部放行 | 完全信任（危险） |
| `denyAll` | ❌ 全部拒绝 | ❌ 全部拒绝 | 锁定状态 |

### 3.2 权限规则

在 `config.toml` 中定义静态规则，避免重复审批：

```toml
# 允许编辑 src/ 目录
[[permission_rules]]
action      = "allow"
toolName    = "edit_file"
pathPattern = "src/**"

# 禁止删除 dist
[[permission_rules]]
action         = "deny"
toolName       = "bash"
commandPrefix  = "rm -rf dist"
```

**自定义安全规则** — 扩展内置的危险命令检测：

```toml
# 禁止 terraform destroy
[[safety_rules]]
type     = "dangerous_command"
pattern  = "\\bterraform\\s+destroy\\b"
category = "terraform-destroy"
risk     = "high"

# 白名单：cargo check 不弹审批
[[safety_rules]]
type     = "safe_command"
pattern  = "cargo check"
category = "cargo-check"
```

### 3.3 沙箱隔离

沙箱为 bash 命令提供 OS 级别的文件系统和网络隔离。

**支持平台：**

| 平台 | native 策略 | Docker 策略 |
|------|------------|------------|
| macOS | ✅ Seatbelt (sandbox-exec) | ✅ |
| Linux / WSL2 | ✅ bubblewrap (bwrap) | ✅ |
| Windows | ❌ | ✅ Docker Desktop |

**配置示例：**

```toml
[sandbox]
enabled      = true
permissions  = "auto-allow"    # 沙箱内命令免审批
# permissions = "default"      # 所有命令走审批

[sandbox.filesystem]
allowWrite = ["~/.npm", "//tmp/build"]   # 额外可写
denyWrite  = ["~/.ssh", "~/.gnupg"]      # 禁止写入
denyRead   = ["~/.aws/credentials"]      # 禁止读取

[sandbox.network]
allowedDomains = ["registry.npmjs.org", "github.com"]
```

**路径前缀约定：**

| 前缀 | 含义 | 示例 |
|------|------|------|
| `//` | 绝对路径 | `//tmp/build` → `/tmp/build` |
| `~/` | HOME 目录 | `~/.kube` → `$HOME/.kube` |
| `./` | 相对于 cwd | `./dist` → `$CWD/dist` |

**逃生舱：** 当命令因沙箱限制失败时，Agent 会自动使用 `dangerouslyDisableSandbox: true` 重试，此时会回到标准权限审批流程。可通过 `allowUnsandboxedCommands = false` 完全禁用此机制。

**排除命令：** Docker 等不兼容沙箱的工具会自动绕过：

```toml
excludedCommands = ["docker", "podman", "nerdctl"]
```

---

## 4. 多模型配置

### 4.1 模型 Profile

定义多个模型，按需切换：

```toml
[models.default]
name          = "gpt-4o-mini"
apiKey        = "sk-xxx"
temperature   = 0.7
contextWindow = 128000

[models.claude]
name          = "claude-sonnet-4-20250514"
provider      = "anthropic"
contextWindow = 200000
maxTokens     = 8192
# apiKey 通过 MODEL_CLAUDE_API_KEY 环境变量设置

[models.deepseek]
name    = "deepseek-chat"
baseUrl = "https://api.deepseek.com/v1"
# apiKey 通过 MODEL_DEEPSEEK_API_KEY 环境变量设置
```

**启动时选择模型：**

```bash
npx tsx src/main.ts chat -m claude
npx tsx src/main.ts ask -m deepseek "解释这段代码"
```

### 4.2 角色绑定

不同场景自动使用不同模型：

```toml
[modelBindings]
compaction = "default"    # 上下文压缩用便宜模型
subagent   = "deepseek"   # 子代理用 DeepSeek
main       = "claude"     # 主对话用 Claude
```

### 4.3 费用追踪

在会话中随时查看费用：

```
/cost
```

输出示例：

```
Session Cost Summary
──────────────────────────
Total cost: $0.0342
API duration: 12.5s
Models used:
  gpt-4o-mini: 15,234 tokens ($0.0152)
  claude-sonnet: 8,120 tokens ($0.0190)
```

---

## 5. 上下文管理

### 5.1 自动压缩

当对话超出上下文窗口时，系统自动进行三层压缩：

1. **micro_compact** — 截断旧的工具输出（保留最近 3 条完整结果）
2. **auto_compact** — 用 LLM 生成对话摘要，替换旧消息
3. **显著性标记** — 关键信息（错误、决策、配置）被标记为 `critical` / `high`，压缩时优先保留

**手动触发：**

```
/compact
```

**查看上下文状态：**

```
/status
```

### 5.2 话题召回

当对话中提到已被压缩的旧话题时，系统会自动从摘要索引中恢复相关上下文。

例如：你在第 10 轮讨论了数据库 schema 设计，第 50 轮再次提到 "数据库"，系统会自动检索并注入之前的设计决策摘要。

### 5.3 会话日志

所有对话自动保存为 JSONL 格式，用于审计和调试：

```
.agent/transcripts/session-<timestamp>.jsonl
```

---

## 6. 任务系统

### 6.1 Todo 工具

Agent 在处理复杂任务时会自动创建结构化任务列表：

```
帮我重构 src/utils/ 下的所有文件
```

Agent 会：
1. 创建 Todo 列表，列出每个需要重构的文件
2. 逐个标记为 `in_progress` → `completed`
3. 你可以随时让它 "查看当前任务进度"

### 6.2 子代理 Task

Agent 可以生成子代理来并行处理子任务：

```
帮我同时做两件事：
1. 在 backend/ 目录实现用户认证 API
2. 在 frontend/ 目录创建登录页面
```

Agent 会为每个子任务创建独立的子代理，各自有隔离的上下文和工具集。

**预配置子代理：**

```toml
[[subagents]]
name         = "researcher"
description  = "只读研究代理"
model        = "deepseek"
allowedTools = ["read_file", "grep", "glob", "bash"]
maxTurns     = 30

[[subagents]]
name         = "coder"
description  = "编码代理"
model        = "claude"
allowedTools = ["read_file", "write_file", "edit_file", "bash", "grep", "glob"]
maxTurns     = 50
```

### 6.3 后台任务

长时间运行的任务可以在后台执行：

```
在后台帮我跑一下完整的测试套件，我继续问其他问题
```

查看后台任务状态：

```
查看后台任务的执行情况
```

---

## 7. 扩展能力

### 7.1 MCP 服务器

通过 Model Context Protocol 接入外部工具。在 `.agent/mcp.json` 中配置：

```json
{
  "mcpServers": {
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "ghp_xxx"
      }
    },
    "postgres": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "DATABASE_URL": "postgresql://localhost/mydb"
      }
    },
    "custom-api": {
      "type": "http",
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

MCP 工具会自动注册为 `mcp__<服务器名>__<工具名>`，在 `/tools` 中可查看。

**使用示例：**

```
帮我查看 GitHub 上 agent-kit 仓库最近的 PR
用 postgres MCP 查询用户表的记录数
```

### 7.2 Skill 技能

Skill 是为 Agent 提供的专业指南，按需加载，不会膨胀 prompt。

**创建 Skill：**

```
.agent/skills/
└── code-review/
    └── SKILL.md
```

```markdown
---
name: code-review
description: 执行全面的代码审查
tags: review,quality
---

# Code Review Skill

## 审查清单

### 1. 安全性
- 检查注入漏洞
- 验证输入校验
...
```

**使用 Skill：**

```
用 code-review 技能审查 src/permission/engine.ts
```

Agent 会自动通过 `load_skill` 工具加载完整的 Skill 内容。

**自定义 Skill 目录：**

```toml
skillDirs = [".agent/skills", "~/.agent-kit/global-skills"]
```

### 7.3 Workflow 工作流

工作流控制 Agent 的可用工具和行为模式：

**代码模式（默认）：**

```
/workflow code
```

全部工具可用，适合开发任务。

**研究模式：**

```
/workflow research
```

只有只读工具（read_file、glob、grep），Agent 不会修改任何文件，适合代码分析和学习。

**关闭工作流：**

```
/workflow off
```

---

## 8. 组合场景

以下场景展示如何组合多个功能来解决实际问题。

### 8.1 全栈项目开发

**配置：**

```toml
[models.default]
name = "gpt-4o"

[models.fast]
name = "gpt-4o-mini"

[modelBindings]
subagent   = "fast"        # 子代理用快速模型降低成本
compaction = "fast"        # 压缩也用快速模型

[sandbox]
enabled     = true
permissions = "auto-allow"  # 编译、安装等命令免审批

[sandbox.filesystem]
allowWrite = ["~/.npm"]     # npm 全局缓存可写

[[permission_rules]]
action      = "allow"
toolName    = "edit_file"
pathPattern = "src/**"

[[permission_rules]]
action      = "allow"
toolName    = "write_file"
pathPattern = "src/**"
```

**使用：**

```
创建一个 Express + React 全栈项目：
1. backend/ 用 Express + TypeScript，实现 REST API
2. frontend/ 用 Vite + React + TypeScript
3. 实现用户注册/登录功能
4. 添加基本的 CRUD 操作
```

Agent 会：
- 创建 Todo 列表追踪进度
- 在沙箱内执行 `npm init`、`npm install` 等命令（免审批）
- 并行用子代理处理前后端
- 自动运行测试验证

### 8.2 遗留代码重构

**配置：**

```toml
workflow = "code"

[[permission_rules]]
action      = "allow"
toolName    = "edit_file"
pathPattern = "src/legacy/**"
```

**Skill 准备：**

```markdown
# .agent/skills/refactor/SKILL.md
---
name: refactor-guide
description: 安全的遗留代码重构指南
tags: refactor,legacy
---

## 重构原则
1. 先写测试，确保现有行为不变
2. 小步重构，每步都能编译通过
3. 先提取函数/类，再改接口
4. 保留 git 历史，不 squash
```

**使用：**

```
请用 refactor-guide 技能来重构 src/legacy/ 目录。
需要：
1. 先分析每个文件的依赖关系
2. 为关键函数补充测试
3. 逐步重构，每步跑一次测试确认
```

### 8.3 安全代码审计

**配置：**

```toml
approval = "confirm"    # 保持审批以确保安全

[[safety_rules]]
type     = "dangerous_command"
pattern  = "\\bcurl\\s+.*\\|\\s*bash"
category = "pipe-to-shell"
risk     = "high"
```

**使用：**

```
用 research 模式审查整个项目的安全性：
/workflow research

请对整个项目进行安全审计，关注：
1. 所有用户输入点的校验
2. SQL 注入风险
3. 硬编码的密钥和凭证
4. 不安全的依赖版本
5. 权限提升漏洞
```

Agent 在 research 模式下只读代码不修改，审计完毕后：

```
/workflow code

请修复上述审计发现的所有问题
```

### 8.4 多仓库自动化

**MCP + 子代理组合：**

```json
// .agent/mcp.json
{
  "mcpServers": {
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_xxx" }
    }
  }
}
```

```toml
# config.toml
[[subagents]]
name         = "pr-reviewer"
description  = "PR 审查代理"
allowedTools = ["read_file", "grep", "glob", "mcp__github__get_pull_request"]
maxTurns     = 20
```

**使用：**

```
帮我审查 agent-kit 仓库最近 5 个 PR，
对每个 PR 生成审查意见，关注安全和性能问题。
```

### 8.5 研究 + 实现 Pipeline

**两阶段工作流：**

```
# 第一阶段：研究
/workflow research

分析 src/context/ 的架构设计，回答：
1. 压缩策略的触发条件是什么？
2. 召回机制的匹配算法？
3. 有哪些可以优化的点？

# 看完研究结果后切换到实现
/workflow code

根据刚才的分析，实现以下优化：
1. 为 recall 添加基于向量的语义匹配
2. 优化 micro_compact 的截断策略
```

**结合 Skill 的研究 Pipeline：**

```markdown
# .agent/skills/architecture-review/SKILL.md
---
name: architecture-review
description: 系统架构评审指南
tags: architecture,review
---

## 评审维度
1. 模块耦合度：模块间是否通过接口通信？
2. 扩展性：添加新功能是否需要修改核心代码？
3. 错误处理：异常是否被正确传播和处理？
4. 性能瓶颈：热路径上是否有不必要的开销？

## 输出格式
- 架构图（用文字描述）
- 每个维度的评分（1-5）和理由
- 具体改进建议（附代码示例）
```

```
用 architecture-review 技能评审整个 agent-kit 项目
```

---

## 9. 配置参考

### `.agent/config.toml` 完整参考

```toml
# ── 基础 ──────────────────────────────────────────────────────
defaultModel = "default"                  # 默认模型 Profile
approval     = "confirm"                  # auto | confirm | deny
maxTurns     = 50                         # 最大对话轮次
# workflow   = "code"                     # 启动时激活的工作流
# userInstructions = "Always reply in Chinese."
# developerInstructions = "Follow AGENT.MD"

# ── 模型 ──────────────────────────────────────────────────────
[models.default]
name          = "gpt-4o-mini"
apiKey        = "sk-xxx"                  # 或 MODEL_DEFAULT_API_KEY 环境变量
baseUrl       = "https://api.openai.com/v1"
temperature   = 0.7
contextWindow = 128000
# maxTokens   = 4096
# provider    = "openai"                  # openai | anthropic

# ── 角色绑定 ──────────────────────────────────────────────────
[modelBindings]
compaction = "default"                    # 上下文压缩
subagent   = "default"                    # 子代理
# main     = "claude"                     # 主对话

# ── 沙箱 ──────────────────────────────────────────────────────
[sandbox]
enabled                  = true
permissions              = "auto-allow"   # auto-allow | default
preferStrategy           = "native"       # native | docker
allowUnsandboxedCommands = true
excludedCommands         = ["docker", "podman", "nerdctl"]

[sandbox.filesystem]
# allowWrite = ["~/.npm"]
# denyWrite  = ["~/.ssh"]
# denyRead   = ["~/.aws/credentials"]

[sandbox.network]
# allowedDomains = ["registry.npmjs.org", "github.com"]

[sandbox.docker]
# image       = "node:20-slim"
# memoryLimit = "512m"

# ── 子代理 ────────────────────────────────────────────────────
# [[subagents]]
# name         = "researcher"
# description  = "只读研究代理"
# model        = "default"
# allowedTools = ["read_file", "grep", "glob"]
# maxTurns     = 30

# ── Skill ─────────────────────────────────────────────────────
# skillDirs = [".agent/skills", "~/.agent-kit/skills"]

# ── 权限规则 ──────────────────────────────────────────────────
# [[permission_rules]]
# action      = "allow"
# toolName    = "edit_file"
# pathPattern = "src/**"

# ── 安全规则 ──────────────────────────────────────────────────
# [[safety_rules]]
# type     = "dangerous_command"
# pattern  = "\\bterraform\\s+destroy\\b"
# category = "terraform-destroy"
# risk     = "high"
```

### `.agent/mcp.json` 参考

```json
{
  "mcpServers": {
    "server-name": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-xxx"],
      "env": { "TOKEN": "xxx" },
      "timeout": 30000
    }
  }
}
```

### `SKILL.md` 格式参考

```markdown
---
name: skill-name
description: 一行描述
tags: tag1,tag2
---

# Skill 标题

完整的指引内容...
```

### 环境变量

| 变量名 | 说明 |
|--------|------|
| `API_KEY` | 全局 API Key 兜底 |
| `BASE_URL` | 全局 Base URL 兜底 |
| `MODEL_<ID>_API_KEY` | 指定 Profile 的 API Key |
| `MODEL_<ID>_BASE_URL` | 指定 Profile 的 Base URL |
| `DEBUG` | 设为任意值启用 debug 日志 |

### CLI 参数

```bash
agent [command] [options]

Commands:
  chat (默认)          交互式对话
  ask <message>        单次提问后退出

Options:
  -m, --model <id>     指定模型 Profile
  --theme <name>       主题 (dark / light)
  -V, --version        版本号
  -h, --help           帮助
```
