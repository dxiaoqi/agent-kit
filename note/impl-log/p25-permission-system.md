# Phase 2.5：权限系统实现日志

> 实现日期：2026-03-14
> 验证：✅ `tsc --noEmit` 零错误，26 测试通过无回归

---

## 一、架构概览

```
                    ┌────────────────────────┐
                    │    PermissionEngine     │
                    │    （决策引擎）          │
                    └────┬────────┬──────────┘
                         │        │
              ┌──────────┘        └──────────┐
              v                              v
    ┌──────────────────┐          ┌─────────────────────┐
    │    RuleStore      │          │   Path/Command      │
    │   （规则存储）     │          │   Safety Check      │
    │  session/project  │          │  （安全底线）        │
    │     /user         │          └─────────────────────┘
    └──────────────────┘
              │
    ┌─────────┴──────────┐
    │   permissions.json  │
    │  （持久化规则）      │
    └────────────────────┘
```

### 决策流程（6 层决策树）

```
┌─ Layer 1: 全局模式 ─────────────────────────────────┐
│  bypassPermissions → ALLOW                          │
│  denyAll → DENY                                     │
│  plan + !readOnly → DENY (返回拒绝消息给 LLM)       │
├─ Layer 2: 安全底线（不可覆盖）──────────────────────┤
│  危险 bash 命令（rm -rf /, sudo, pipe-to-shell）    │
│     → DENY                                          │
│  高敏感路径（.env, .ssh, /etc）+ 写操作             │
│     → ASK (high risk)                               │
├─ Layer 3: 规则存储匹配 ────────────────────────────┤
│  deny 规则优先 → DENY                              │
│  allow 规则 → ALLOW                                 │
├─ Layer 4: 工具属性 ────────────────────────────────┤
│  isReadOnly → ALLOW                                 │
├─ Layer 5: 模式默认行为 ────────────────────────────┤
│  acceptEdits + 工作区内文件 → ALLOW                 │
├─ Layer 6: 默认 ───────────────────────────────────┤
│  → ASK (根据风险评估确定 riskLevel)                 │
└─────────────────────────────────────────────────────┘
```

---

## 二、新增文件

| 文件 | 行数 | 职责 |
|------|------|------|
| `src/permission/types.ts` | ~65 | 权限模式、规则、决策、查询类型定义 |
| `src/permission/paths.ts` | ~135 | 敏感路径检测 + bash 命令安全检测 + glob 匹配 |
| `src/permission/rules.ts` | ~160 | RuleStore：三级作用域规则 CRUD + 持久化 |
| `src/permission/engine.ts` | ~185 | PermissionEngine：6 层决策树 + 审批处理 |

## 三、修改文件

| 文件 | 改动 |
|------|------|
| `src/kernel/agent.ts` | 注入 PermissionEngine，工具执行前 checkPermission，resolvePermission 回调 |
| `src/kernel/events.ts` | 添加 `permissionRequest` 工厂函数 |
| `src/main.ts` | 创建 RuleStore + PermissionEngine，根据 approval 配置设置初始模式 |
| `src/ui/hooks/use-agent.ts` | 添加 pendingPermission 状态 + resolvePermission 回调 |
| `src/ui/screens/REPL.tsx` | 渲染 PermissionDialog，添加 /mode 命令 |

---

## 四、关键设计决策

### 4.1 异步审批机制

Agent 循环使用 AsyncGenerator，权限检查通过 Promise 挂起：

```typescript
// engine.ts 返回 "ask" → agent.ts 发射 permission_request 事件
yield AgentEvents.permissionRequest(requestId, ...);

// 挂起等待 UI 回调
const response = await new Promise<ApprovalResponse>((resolve) => {
    this.pendingApproval = { resolve };
});

// UI 调用 agent.resolvePermission() → 解锁 Promise
```

### 4.2 规则持久化

```
session  → 内存中，会话结束即失效
project  → .agent/permissions.json（跟随项目）
user     → ~/.config/agent-kit/permissions.json（全局）
```

规则匹配优先级：deny > allow，session > project > user。

### 4.3 安全底线不可覆盖

即使在 bypassPermissions 模式下，以下操作仍会被拦截：
- `rm -rf /`, `sudo`, `dd`, `mkfs` 等危险命令
- `.env`, `.ssh/`, `.aws/` 等敏感路径的写操作

这是"最后防线"，来自 Kode-Agent 的 safety floor 设计。

### 4.4 配置集成

```toml
# .agent/config.toml
approval = "confirm"   # auto → bypassPermissions, confirm → default, deny → denyAll
```

---

## 五、UI 交互流

```
Agent 调用 bash("npm install")
  │
  ├─ Engine: bash 非安全命令前缀 → decision: "ask", risk: "moderate"
  │
  ├─ Agent yield: permission_request 事件
  │
  ├─ UI: 渲染 PermissionDialog
  │   ┌────────────────────────────────────┐
  │   │ Permission required                │
  │   │                                    │
  │   │ bash                               │
  │   │ {"command": "npm install"}         │
  │   │                                    │
  │   │ ❯ Yes, allow this                  │
  │   │   Yes, always allow this tool      │
  │   │   No, deny                         │
  │   └────────────────────────────────────┘
  │
  ├─ 用户选择 "Yes, always allow this tool"
  │
  ├─ resolvePermission(true, "project")
  │   ├─ Agent Promise 解锁
  │   └─ Engine.handleApproval → RuleStore 添加 allow 规则
  │
  └─ 工具执行继续
```

---

## 六、验证

```bash
# 类型安全
npx tsc --noEmit     # ✅ 零错误

# 回归测试
npm test             # ✅ 26/26 通过

# Slash 命令
/mode                # 循环切换 default → acceptEdits → plan → bypassPermissions
/status              # 显示当前权限模式（TODO：可在 status 中添加权限信息）
```

---

## 七、自定义安全规则扩展（SafetyRegistry）

### 7.1 设计目标

将危险命令/敏感路径/安全白名单从硬编码改为**可扩展的注册表模式**，支持三种扩展入口：

| 入口 | 使用者 | 持久化 |
|------|--------|--------|
| **配置文件** `.agent/config.toml` `[[safety_rules]]` | 项目维护者 | 跟随项目 |
| **编程式** `engine.registerSafetyRule(rule)` | 插件开发者 | 内存/插件自管 |
| **批量加载** `engine.loadSafetyRulesFromConfig(rules)` | 启动阶段 | 内存 |

### 7.2 类型定义

```typescript
interface CustomSafetyRule {
    pattern: string;                                   // 正则或前缀
    category: string;                                  // 分类标识
    type: "dangerous_command" | "sensitive_path" | "safe_command";
    risk?: "moderate" | "high";                        // 仅 dangerous/sensitive
}
```

### 7.3 SafetyRegistry 单例

`SafetyRegistry` 作为单例维护三个自定义集合，与内置规则合并检查：

- `dangerousCommands[]` → 与 `BUILTIN_DANGEROUS_COMMANDS` 合并
- `sensitivePathPatterns[]` → 与 `SENSITIVE_PATTERNS` 合并
- `safePrefixes: Set<string>` → 与 `BUILTIN_SAFE_COMMAND_PREFIXES` 合并

规则加载时验证正则合法性，非法正则跳过并报错。

### 7.4 配置文件示例

```toml
# .agent/config.toml

# 禁止 terraform destroy
[[safety_rules]]
type     = "dangerous_command"
pattern  = "\\bterraform\\s+destroy\\b"
category = "terraform-destroy"
risk     = "high"

# 保护 Kubernetes 配置
[[safety_rules]]
type     = "sensitive_path"
pattern  = "\\.kube/config$"
category = "kube-config"
risk     = "high"

# 白名单: cargo check
[[safety_rules]]
type     = "safe_command"
pattern  = "cargo check"
category = "cargo-check"
```

### 7.5 数据流

```
config.toml (TOML parse)
  → safety_rules: CustomSafetyRule[]
    → main.ts: engine.loadSafetyRulesFromConfig(rules)
      → SafetyRegistry.register() (验证 + 编译 RegExp)
        → checkCommandSafety() / checkPathSensitivity() 合并检查
```

### 7.6 验证

```bash
npx tsc --noEmit     # ✅ 零错误
```

---

## 八、配置收敛 — 移除独立 JSON 持久化

### 8.1 变更动机

原方案中 `RuleStore` 维护三级持久化（session / project JSON / user JSON），存在多配置源读取和同步问题。
收敛为 **config.toml 单一配置源**，简化架构。

### 8.2 变更清单

| 文件 | 变更 |
|------|------|
| `types.ts` | `RuleScope`: `session \| project \| user` → `session \| config` |
| `config.ts` | 新增 `permissionRules` + `safetyRules` 到 `ConfigSchema` (Zod) |
| `loader.ts` | `normKeys` 增加数组元素递归处理，确保 TOML 数组内 snake_case → camelCase |
| `rules.ts` | 完全重写：移除 JSON read/write/`fs` 引用，改为 `loadFromConfig()` 注入 |
| `engine.ts` | `handleApproval` 只写 session；移除 `RuleScope` import |
| `main.ts` | 移除 `getConfigDir` 引用；从 `config.permissionRules` 注入 `RuleStore` |
| `use-agent.ts` | `resolvePermission` 签名 `"project"\|"user"` → `"session"\|"config"` |
| `REPL.tsx` | "always" persist 改为 `"session"`，移除 `"always_user"` 分支 |
| `.agent/permissions.json` | **已删除** |
| `.agent/config.toml` | 新增 `[[permission_rules]]` 配置段 |

### 8.3 新的规则层级

```
┌──────────────────────────────────────────────────┐
│              config.toml                         │
│  [[permission_rules]]   ← 静态，只读，跟随项目     │
│  [[safety_rules]]       ← 静态，只读，扩展检测     │
├──────────────────────────────────────────────────┤
│  Session Rules          ← 运行时审批产生，内存     │
│  （"Yes, always" → session scope）               │
└──────────────────────────────────────────────────┘
   匹配优先级：deny > allow，session > config
```

### 8.4 配置示例

```toml
# .agent/config.toml

# 允许所有 src/ 下的文件编辑
[[permission_rules]]
action      = "allow"
toolName    = "edit_file"
pathPattern = "src/**"

# 禁止 terraform destroy
[[safety_rules]]
type     = "dangerous_command"
pattern  = "\\bterraform\\s+destroy\\b"
category = "terraform-destroy"
risk     = "high"
```

### 8.5 验证

```bash
npx tsc --noEmit     # ✅ 零错误
```
