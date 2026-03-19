# Phase 7：Sandbox 沙箱系统（对齐 Claude Code 设计）

## 参考

- [Claude Code Sandboxing 文档](https://code.claude.com/docs/zh-CN/sandboxing)

## 设计目标

对齐 Claude Code 的沙箱架构，为 BashTool 提供 OS 级进程隔离：

1. **多策略架构**：native（Seatbelt / bwrap）为主，Docker 为跨平台备选
2. **双权限模式**：`auto-allow`（沙箱内免审批）vs `default`（全部走审批）
3. **文件系统隔离**：`allowWrite` / `denyWrite` / `denyRead` 分层控制
4. **网络隔离**：域名白名单 + 代理端口预留
5. **逃生舱**：`dangerouslyDisableSandbox` 参数 + `excludedCommands`
6. **跨平台**：macOS (Seatbelt) / Linux (bwrap) / WSL2 (bwrap) / Windows (Docker)

## 核心架构

```
config.toml [sandbox]
    ├── enabled / permissions / preferStrategy
    ├── filesystem: { allowWrite, denyWrite, denyRead }
    ├── network: { allowedDomains, proxy ports }
    └── docker: { image, limits }
          │
          ▼
    SandboxExecutor
    ├── resolveStrategy()
    │   ├── preferStrategy → native / docker
    │   └── 回退链：native > docker > direct
    ├── isCommandExcluded(cmd)
    │   └── excludedCommands 匹配 → 跳过沙箱
    ├── willSandbox(cmd) → boolean
    │   └── 供 PermissionEngine 查询
    └── execute(cmd, cwd, signal, opts)
        ├── !enabled → direct
        ├── excluded → direct
        ├── dangerouslyDisableSandbox → direct (需审批)
        ├── strategy available → sandboxed
        └── fallback → direct

BashTool
    ├── inputSchema.dangerouslyDisableSandbox
    └── execute → SandboxExecutor.execute()

PermissionEngine
    Layer 2.5: sandboxAutoAllow + willSandbox(cmd) → ALLOW
```

## 文件清单

| 文件 | 职责 |
|------|------|
| `src/sandbox/types.ts` | `SandboxConfig`, `FilesystemConfig`, `NetworkConfig`, `SandboxPermissions`, `SandboxStrategy` 接口, `resolveSandboxPath`（`//`, `~/`, `./` 路径前缀） |
| `src/sandbox/native.ts` | `MacOSNativeStrategy` (Seatbelt SBPL), `LinuxNativeStrategy` (bwrap), `generateSBPL()`, `generateBwrapArgs()` |
| `src/sandbox/docker.ts` | `DockerStrategy`（容器隔离，`--cap-drop=ALL`, `--network=none`, UID mapping） |
| `src/sandbox/executor.ts` | `SandboxExecutor`（多策略选择器，`excludedCommands`, `dangerouslyDisableSandbox`, `willSandbox`） |
| `src/sandbox/index.ts` | 模块导出 |
| `src/tool/builtin/bash.ts` | `dangerouslyDisableSandbox` 参数，沙箱/直接执行分流 |
| `src/permission/engine.ts` | `configureSandbox()`, Layer 2.5 auto-allow 基于 `willSandbox()` |
| `src/prompt/modules/environment.ts` | 系统 prompt 注入沙箱状态（mode、escape hatch 提示） |
| `src/prompt/types.ts` | `PromptContext.sandboxInfo` |
| `src/config/config.ts` | `SandboxConfigSchema`（filesystem/network/docker 子 schema） |
| `.agent/config.toml` | `[sandbox]` + `[sandbox.filesystem]` + `[sandbox.network]` |
| `src/main.ts` | 初始化 `SandboxExecutor`, 注入 BashTool, 集成 PermissionEngine |

## 核心设计（对齐 Claude Code）

### 1. 双权限模式

| 模式 | 行为 | 对应 Claude Code |
|------|------|-----------------|
| `auto-allow` | 沙箱内的命令免审批，不走权限流程 | ✅ 自动允许模式 |
| `default` | 所有命令走标准审批，即使在沙箱中 | ✅ 常规权限模式 |

两种模式下沙箱都强制执行相同的文件系统和网络限制，区别仅在权限提示。

### 2. 文件系统隔离（Claude Code 模型）

```
cwd 及子目录 → 读写（默认）
allowWrite   → 额外读写（如 ~/.kube, //tmp/build）
denyWrite    → 禁止写入（如 ~/.ssh, ~/.gnupg）
denyRead     → 禁止读取（如 ~/.aws/credentials）
系统路径      → 只读（/usr, /bin, /etc...）
```

路径前缀约定：
| 前缀 | 含义 | 示例 |
|------|------|------|
| `//` | 文件系统根的绝对路径 | `//tmp/build` → `/tmp/build` |
| `~/` | 相对于 $HOME | `~/.kube` → `$HOME/.kube` |
| `./` 或无前缀 | 相对于 cwd | `./dist` → `$CWD/dist` |

### 3. 网络隔离

- `allowedDomains`：域名白名单
- `allowManagedDomainsOnly`：是否自动拒绝非白名单域名
- `httpProxyPort` / `socksProxyPort`：自定义代理端口预留

### 4. 逃生舱机制

```typescript
// BashTool 参数
dangerouslyDisableSandbox: true  // 跳过沙箱，走权限审批

// 配置控制
allowUnsandboxedCommands = true  // 允许逃生舱（false = 完全禁用）
excludedCommands = ["docker"]     // 不兼容沙箱的命令
```

### 5. 多策略优先级

```
auto 模式选择策略：
  1. preferStrategy (native / docker)
  2. 另一个策略
  3. direct（无沙箱回退）
```

| 策略 | 平台 | 隔离强度 | 依赖 |
|------|------|----------|------|
| `native` | macOS (Seatbelt), Linux (bwrap) | OS 级 | 系统自带或 `apt install bubblewrap` |
| `docker` | 全平台 | 容器级 | Docker Engine |

### 6. macOS Seatbelt SBPL

```scheme
(version 1)
(deny default)
(allow process-exec)
(allow file-read* (subpath "/usr"))      ; 系统只读
(allow file-write* (subpath "<cwd>"))    ; CWD 可写
(allow file-write* (subpath "~/.kube"))  ; allowWrite
(deny file-write* (subpath "~/.ssh"))    ; denyWrite
(deny file-read* (subpath "~/.aws"))     ; denyRead
(allow network*)                          ; 域名过滤由代理层处理
```

### 7. Docker 安全加固

```bash
docker run --rm -i \
  --network=none \
  --memory=512m --cpus=1 --pids-limit=256 \
  --security-opt=no-new-privileges \
  --cap-drop=ALL --cap-add=CHOWN,DAC_OVERRIDE,FOWNER,SETGID,SETUID \
  --user=<uid>:<gid> \
  --tmpfs=/tmp:rw,noexec,nosuid,size=64m \
  -v <cwd>:/workspace -w /workspace \
  node:20-slim bash -c "<command>"
```

## 验证

- `npx tsc --noEmit` → 0 errors
- Linting → 0 issues
- 配置格式与 Claude Code `settings.json` 的 `sandbox` 段对齐
- 权限引擎双模式工作：`auto-allow` + `willSandbox()` → 免审批；`default` → 走审批
- `dangerouslyDisableSandbox` 逃生舱可被 `allowUnsandboxedCommands=false` 完全禁用
- `excludedCommands` 正确跳过 docker、podman 等不兼容命令
