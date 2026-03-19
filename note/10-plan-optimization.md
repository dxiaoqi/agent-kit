# 10 — Plan 系统优化笔记

基于首次真实 Plan 执行（全栈项目创建）的日志分析，识别并修复了 8 个优化场景。

## 问题来源

首次 Plan 执行日志：`.agent/transcripts/session-1773920715233.jsonl`
计划文件：`.agent/plans/plan-1773920800433.json`

任务：创建 Express + React 全栈项目（15 步计划）
结果：执行到 Step 10（前端初始化）时卡死，消耗 702.6K tokens，50 轮用完

---

## P0 级修复（直接导致任务失败）

### 1. 交互式命令识别 + 重试死循环防护

**问题**：`create-vite` 是交互式命令，在非 TTY 环境必然失败。Agent 连续尝试 8 种写法全部失败，最终用户拒绝操作。

**根因**：Agent 不知道环境不支持交互式命令，也没有失败次数上限。

**修复**：`src/prompt/modules/behavior.ts`
- 新增 `## Shell Command Constraints` 明确列出不支持的交互式命令
- 新增 `## Error Recovery Strategy` 规定：
  - 相同命令最多重试 2 次
  - 2 次后必须换方案
  - 沙箱失败第一次重试立即加 `dangerouslyDisableSandbox`

```typescript
// behavior.ts 关键新增
`## Shell Command Constraints
**Interactive commands are NOT supported.** The shell runs in non-TTY mode. NEVER use:
- npm create, npx create-xxx, npm init @xxx
- yo, ng new, create-react-app
...
## Error Recovery Strategy
**CRITICAL: Do NOT retry the same failing command more than 2 times.**`
```

### 2. 沙箱失败快速升级策略

**问题**：`mkdir -p` 在沙箱内失败 4 次后才加 `dangerouslyDisableSandbox`。

**根因**：提示词只说"如果失败可以加 dangerouslyDisableSandbox"，没有要求立即升级。

**修复**：`src/prompt/modules/environment.ts`
- 沙箱提示从建议改为强制："immediately retry with dangerouslyDisableSandbox: true — do NOT retry the same sandboxed command"

---

## P1 级修复（用户体验严重受损）

### 3. 强化提示词 — 复杂任务必须先调 plan 工具

**问题**：Agent 收到复杂任务后先用纯文本描述"计划"，用户确认后才发现没有真正调用 `plan` 工具，传了中文标题作为 planId → Plan not found。

**修复**：`src/prompt/modules/planning.ts`
- 新增强制规则：`RULE: For any task requiring 5+ tool calls, ALWAYS call plan({ goal }) FIRST.`
- 明确禁止：`NEVER describe a plan in plain text then try to approve it`
- 强调：`approve with the **exact plan ID** (e.g., plan-1234567890)`

### 4. Plan 管理工具自动放行

**问题**：`plan_step_done` 每次都弹权限审批对话框，15 步计划需要审批 15 次纯状态更新。

**修复**：
- `src/planner/tool.ts`：`plan_approve` 和 `plan_step_done` 的 `isReadOnly` 改为 `true`
- `src/permission/engine.ts`：新增 Layer 1.5，plan 系列工具（plan, plan_approve, plan_step_done, plan_status）全部自动放行

```typescript
// engine.ts Layer 1.5
const planTools = ["plan", "plan_approve", "plan_step_done", "plan_status"];
if (planTools.includes(query.toolName)) {
    return allow("Plan management tool: auto-approved", "low");
}
```

### 5. 会话级权限记忆

**问题**：用户批准 `bash + dangerouslyDisableSandbox` 一次后，后续每次 npm install 都还要再审批。

**修复**：`src/permission/engine.ts`
- 新增 `_planAutoApprovePatterns: Set<string>` 会话级记忆
- `handleApproval()` 中自动记录审批模式（如 `bash:npm:unsandboxed`、`write_file:workspace`）
- 新增 Layer 3.5 在规则匹配后、默认 ASK 前，检查是否匹配已审批模式
- 模式格式：`{toolName}:{commandPrefix}[:unsandboxed]`

```typescript
// 审批记忆流程
用户批准 bash({ command: "npm install ...", dangerouslyDisableSandbox: true })
  → 记录 "bash:npm:unsandboxed"
后续 bash({ command: "npm install something-else", dangerouslyDisableSandbox: true })
  → 匹配 "bash:npm:unsandboxed" → 自动放行
```

---

## P2 级修复（效率与成本优化）

### 6. plan_step_done 返回精简指令

**问题**：每步返回的指令包含完整 Plan Context + Previous Step Results，累计重复传输大量相同文本，702.6K tokens 中大部分是冗余。

**修复**：`src/planner/tool.ts` 的 `formatStepInstruction()`
- Plan Context 只在第一步（`isFirstStep`）传输
- Previous Step Results 精简为单行摘要（300 字符截断，只包含直接依赖）
- 移除冗余的 "Execute this step using the appropriate tools" 长提示
- 将 `plan_step_done` 调用指令压缩为一行

**预估效果**：每步节省约 500-1000 tokens，15 步计划节省 ~10K tokens

### 7. Planner 步骤粒度优化

**问题**：生成了 15 步计划，其中 step-2（npm init + install）和 step-3（install more deps）可合并；step-5~9 都是后端文件创建，过于碎片化。

**修复**：`src/planner/planner.ts` 的 Planning Principles
- 目标步骤数从 "3-15" 调整为 **5-10**
- 新增原则：
  - "Combine npm install commands — ALL dependencies for a module should be installed in a single step"
  - "Combine file creation — Multiple related files can be ONE step"
  - "Right granularity: Each step should represent a logical unit of work, NOT a single command"
- 新增 Environment Constraints 告知非 TTY 环境限制

### 8. DAG 并行步骤通知

**问题**：Plan 中 step-10（前端）依赖 step-1，理论上可与 step-2~9（后端）并行。但逐步执行模型是串行的。

**修复**：
- `src/planner/store.ts`：新增 `getReadySteps()` 返回所有就绪步骤（而非只返回第一个）
- `src/planner/tool.ts`：`plan_step_done` 在有多个就绪步骤时追加并行提示

```typescript
// plan_step_done 返回示例
## Step 10/15: 初始化前端项目
...
**Note:** 1 additional step(s) are ready and could run in parallel via `task` tool:
  - step-11: 创建前端认证页面
```

Agent 可以选择用 `task` 工具并发执行，或串行处理。

---

## 修改文件汇总

| 文件 | 优化项 |
|------|--------|
| `src/prompt/modules/behavior.ts` | P0-1: 交互式命令黑名单 + 重试上限 |
| `src/prompt/modules/environment.ts` | P0-2: 沙箱失败立即升级 |
| `src/prompt/modules/planning.ts` | P1-1: 强制先调 plan 工具 |
| `src/planner/tool.ts` | P1-2: isReadOnly=true; P2-1: 精简输出; P2-3: 并行通知 |
| `src/permission/engine.ts` | P1-2: Layer 1.5 自动放行; P1-3: 会话级审批记忆 |
| `src/planner/planner.ts` | P2-2: 步骤粒度 5-10 + 环境约束 |
| `src/planner/store.ts` | P2-3: getReadySteps() |

## 权限引擎决策树（更新后）

```
Layer 1    : bypassPermissions → ALLOW
Layer 1.5  : Plan 工具 → ALLOW                    ← 新增
Layer 2    : denyAll / plan mode → DENY
Layer 2    : Safety Floor (路径/命令) → DENY/ASK
Layer 2.5  : Sandbox auto-allow → ALLOW
Layer 3    : Rule Store 匹配 → ALLOW/DENY
Layer 3.5  : 会话级审批记忆 → ALLOW               ← 新增
Layer 4    : isReadOnly → ALLOW
Layer 5    : acceptEdits + workspace → ALLOW
Layer 6    : default → ASK
```

## 验证

`tsc --noEmit` 零错误通过。
