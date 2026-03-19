# Step 0.7: Config 修复

## 改动路径

```
修改  .agent/config.toml                # 移除硬编码 apiKey，修复 maxTurns 类型
修改  src/client/model_registry.ts       # 移除重复 env var 解析
新建  .env.example                       # 环境变量配置指引
```

## 思路

### 问题 1：API Key 硬编码

```toml
# 旧
apiKey = "sk-LszQXhnMAVdrvlEKr38YhZOQWtRkJt3Q8QVt0qls2nth8ym8"
```

真实 key 写在配置文件里，一旦 git push 就泄露。

### 问题 2：maxTurns 类型

```toml
# 旧
maxTurns = "50"    # ← 字符串！Zod schema 期望 number
```

TOML 解析后是 `"50"`（string），传给 `z.number()` 会报错（除非 Zod 恰好 coerce）。

### 问题 3：env var 解析重复

环境变量解析同时发生在两处：
- `config/loader.ts` 第 97-108 行
- `client/model_registry.ts` 第 27-34 行

两处逻辑相同但独立维护。

### 修复

1. **移除硬编码**：config.toml 不写 apiKey/baseUrl，改为注释指引用 env var
2. **修复类型**：`maxTurns = 50`（去掉引号）
3. **去重**：`model_registry.ts` 的 `resolveProfile` 不再做 env var 解析，统一由 `config/loader.ts` 处理
4. **新增 .env.example**：告诉用户如何配置

## 效果

### Before

```
config.toml 有明文 API Key → 安全隐患
maxTurns = "50" → 可能 Zod 校验失败
env var 在两处解析 → 维护困难
```

### After

```
config.toml 无密钥 → 安全
maxTurns = 50 → 类型正确
env var 只在 loader.ts 解析 → 单一职责
.env.example → 清晰的配置指引
```

## 验证方式

```bash
# 1. 确认 config.toml 无密钥
grep -c "sk-" .agent/config.toml  # 应输出 0

# 2. 确认 maxTurns 是数字
grep "maxTurns" .agent/config.toml  # 应显示 maxTurns = 50（无引号）

# 3. 确认 model_registry 不再解析 env var
grep "process.env" src/client/model_registry.ts  # 应无匹配
```
