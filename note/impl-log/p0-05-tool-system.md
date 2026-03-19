# Step 0.5: Tool 接口 + ToolRegistry

## 改动路径

```
新建  src/tool/types.ts       # ToolDef / ToolResult / ToolContext / ToolJsonSchema
新建  src/tool/registry.ts    # ToolRegistry + zodToJsonSchema + normalizeToSize
```

## 思路

### 问题

旧版 Agent 的工具系统是两个 stub 函数，没有任何工具接口定义：

```typescript
protected getToolSchemas(): null { return null; }
protected async executeTools(_: ToolCall[]): Promise<boolean> { return true; }
```

### 方案

定义完整的工具契约，让 Plugin 可以注册工具：

1. **ToolDef 接口**：name + description(= prompt) + Zod inputSchema + isReadOnly + execute()
2. **ToolRegistry 类**：注册 / 查找 / 获取 JSON Schema / 执行（含校验+截断）
3. **zodToJsonSchema()**：Zod schema → JSON Schema 转换（LLM API 需要）
4. **normalizeToSize()**：智能截断大输出（保留首尾各 40%）

### 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 输入校验 | Zod schema | 类型安全 + 自动生成 JSON Schema + 运行时校验一体 |
| JSON Schema 转换 | 手动实现核心子集 | zod-to-json-schema 库太重，只需处理 string/number/boolean/object/array/enum |
| 输出截断 | normalizeToSize（首尾 40%） | 比纯截断好——保留结尾可能有关键信息 |
| isReadOnly 标记 | 放在 ToolDef 上 | 影响：权限检查（Phase 2）+ 结果缓存（Phase 2）+ 子代理限制（Phase 4） |
| 执行错误处理 | catch → ToolResult.error | 工具不应该抛异常到 Agent 循环 |

### ToolRegistry.execute 执行流程

```
rawInput ──→ Zod 校验 ──→ tool.execute(parsed, ctx) ──→ normalizeToSize ──→ ToolResult
        ↓ 校验失败        ↓ 执行异常
        → { error }       → { error }
```

### zodToJsonSchema 支持的类型

| Zod 类型 | JSON Schema |
|----------|-------------|
| z.string() | `{ type: "string" }` |
| z.number() | `{ type: "number" }` |
| z.boolean() | `{ type: "boolean" }` |
| z.array(z.string()) | `{ type: "array", items: { type: "string" } }` |
| z.enum(["a", "b"]) | `{ type: "string", enum: ["a", "b"] }` |
| z.object({ ... }) | `{ type: "object", properties: {...}, required: [...] }` |
| z.string().optional() | 从 required 中移除 |
| z.string().describe("desc") | 添加 description 字段 |

## 效果

### Before

```typescript
// 无法注册工具，无法生成 schema，无法执行
const schemas = null;  // ← Agent 没有工具
```

### After

```typescript
const registry = new ToolRegistry();
registry.register({
    name: "read_file",
    description: "Read a file from the filesystem",
    inputSchema: z.object({
        path: z.string().describe("Absolute path to read"),
    }),
    isReadOnly: true,
    async execute(input) {
        const content = await readFile(input.path, "utf-8");
        return { success: true, output: content };
    },
});

// 给 LLM 的 schema
const schemas = registry.getSchemas();
// → [{ name: "read_file", description: "...", parameters: { type: "object", ... } }]

// 执行工具（自动校验+截断）
const result = await registry.execute("read_file", { path: "/tmp/foo" }, ctx);
// → { success: true, output: "file contents..." }
```

## 验证方式

```bash
# 1. 类型检查
npx tsc --noEmit src/tool/types.ts src/tool/registry.ts

# 2. 验证 Zod → JSON Schema 转换
# zodToJsonSchema(z.object({ path: z.string(), count: z.number().optional() }))
# 应输出：{ type: "object", properties: { path: { type: "string" }, count: { type: "number" } }, required: ["path"] }

# 3. 验证 normalizeToSize
# normalizeToSize("a".repeat(50000), 30000)
# → 长度应为 ~30000 + 中间摘要文字
```
