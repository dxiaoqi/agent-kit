// ── 标准测试剧本 ─────────────────────────────────────────────────
// 5 类记忆能力 × 每类 1-2 个场景 = 7 个标准化剧本
// 设计原则：
//   1. 每个剧本包含「植入阶段 → 干扰阶段 → 探测阶段」三幕
//   2. 干扰阶段使用 filler 消耗上下文窗口，迫使系统压缩
//   3. 探测阶段通过精确关键词和语义检查评分

import type { BenchmarkScenario } from "./protocol.js";

// ── 1. 话题回温（Topic Recall）────────────────────────────────────

export const topicRecallBasic: BenchmarkScenario = {
    id: "topic-recall-basic",
    category: "topic_recall",
    description: "基础话题回温：讨论 TOML 配置 → 大量填充 → 再次询问配置",
    steps: [
        // 植入阶段
        { type: "user", content: "我的项目使用 config.toml 配置文件，里面有一个 maxTurns = 50 的参数控制最大对话轮次，还有 contextWindow = 128000 控制上下文窗口大小。帮我记住这些配置。" },
        // 干扰阶段
        { type: "filler", turns: 30, topic: "React组件开发和CSS样式调试" },
        // 探测阶段
        {
            type: "checkpoint",
            probe: "我之前提到的配置文件里 maxTurns 设置的是多少？",
            criteria: [
                { type: "keyword_present", value: "50", weight: 0.5 },
                { type: "keyword_present", value: "maxTurns", weight: 0.2 },
                { type: "keyword_present", value: "config", weight: 0.15 },
                { type: "keyword_absent", value: "不记得", weight: 0.15 },
            ],
        },
    ],
};

export const topicRecallDeep: BenchmarkScenario = {
    id: "topic-recall-deep",
    category: "topic_recall",
    description: "深度话题回温：多轮技术讨论 → 超长填充 → 追问技术细节",
    steps: [
        { type: "user", content: "我们在重构数据库层，决定从 MySQL 迁移到 PostgreSQL。主要原因是需要 JSONB 类型支持和更好的全文搜索。迁移脚本放在 scripts/migrate-pg.sh 里。" },
        { type: "user", content: "迁移中遇到一个问题：MySQL 的 TINYINT(1) 映射到 PostgreSQL 时要用 BOOLEAN，不能直接用 SMALLINT。" },
        { type: "filler", turns: 50, topic: "前端性能优化和打包配置" },
        {
            type: "checkpoint",
            probe: "我们之前讨论的数据库迁移，MySQL 的 TINYINT(1) 在 PostgreSQL 里应该映射成什么类型？",
            criteria: [
                { type: "keyword_present", value: "BOOLEAN", weight: 0.4 },
                { type: "keyword_absent", value: "SMALLINT", weight: 0.2 },
                { type: "keyword_present", value: "PostgreSQL", weight: 0.2 },
                { type: "semantic_match", value: "不应该用 SMALLINT 而是 BOOLEAN", weight: 0.2 },
            ],
        },
    ],
};

// ── 2. 错误记忆（Error Memory）────────────────────────────────────

export const errorMemory: BenchmarkScenario = {
    id: "error-memory",
    category: "error_memory",
    description: "错误记忆：报告关键错误 → 填充 → 追问错误详情",
    steps: [
        { type: "user", content: "运行时报了一个严重错误：TypeError: Cannot read properties of undefined (reading 'prepareForLLMCall') at Agent.executeTurn (src/kernel/agent.ts:142:38)。我们发现是因为 ContextManager 没有在构造函数里正确初始化。" },
        { type: "user", content: "修复方法是在 Agent 构造函数中添加 this.ctx = new ContextManager(config)，而不是延迟初始化。" },
        { type: "filler", turns: 40, topic: "UI组件样式和主题配色方案讨论" },
        {
            type: "checkpoint",
            probe: "之前那个 TypeError 错误发生在哪个文件的哪一行？是什么原因导致的？",
            criteria: [
                { type: "keyword_present", value: "agent.ts", weight: 0.25 },
                { type: "keyword_present", value: "142", weight: 0.15 },
                { type: "keyword_present", value: "ContextManager", weight: 0.25 },
                { type: "semantic_match", value: "构造函数中没有正确初始化", weight: 0.2 },
                { type: "keyword_present", value: "prepareForLLMCall", weight: 0.15 },
            ],
        },
    ],
};

// ── 3. 决策一致性（Decision Consistency）──────────────────────────

export const decisionConsistency: BenchmarkScenario = {
    id: "decision-consistency",
    category: "decision_consistency",
    description: "决策一致性：做出架构决策 → 填充 → 验证决策未被遗忘或篡改",
    steps: [
        { type: "user", content: "经过讨论，我们做出以下架构决策：1) 插件系统使用事件驱动模式而不是接口注册模式。2) 状态管理使用不可变数据结构。3) 所有 IO 操作必须通过 Provider 抽象层。请记住这三条决策。" },
        { type: "filler", turns: 35, topic: "测试框架选型和CI/CD流水线配置" },
        {
            type: "checkpoint",
            probe: "我们之前确定的三条架构决策是什么？请列出来。",
            criteria: [
                { type: "keyword_present", value: "事件驱动", weight: 0.2 },
                { type: "keyword_absent", value: "接口注册", weight: 0.1 },
                { type: "keyword_present", value: "不可变", weight: 0.2 },
                { type: "keyword_present", value: "Provider", weight: 0.2 },
                { type: "semantic_match", value: "列出了三条决策且内容与原始一致", weight: 0.3 },
            ],
        },
    ],
};

// ── 4. 细节保留（Detail Retention）────────────────────────────────

export const detailRetentionPaths: BenchmarkScenario = {
    id: "detail-retention-paths",
    category: "detail_retention",
    description: "细节保留（路径）：提供精确文件路径和数值 → 填充 → 追问精确值",
    steps: [
        { type: "user", content: "项目关键文件路径：入口文件是 src/main.ts，核心循环在 src/kernel/agent.ts，配置加载器在 src/config/loader.ts，上下文管理器在 src/context/manager.ts。端口号是 3847，API 密钥前缀是 sk-proj-Qx7。" },
        { type: "filler", turns: 40, topic: "Docker容器编排和Kubernetes部署" },
        {
            type: "checkpoint",
            probe: "上下文管理器的文件路径是什么？端口号是多少？",
            criteria: [
                { type: "keyword_present", value: "src/context/manager.ts", weight: 0.35 },
                { type: "keyword_present", value: "3847", weight: 0.35 },
                { type: "keyword_absent", value: "不确定", weight: 0.15 },
                { type: "keyword_absent", value: "不记得", weight: 0.15 },
            ],
        },
    ],
};

export const detailRetentionNumbers: BenchmarkScenario = {
    id: "detail-retention-numbers",
    category: "detail_retention",
    description: "细节保留（数值）：多组精确数值参数 → 填充 → 验证数值准确性",
    steps: [
        { type: "user", content: "性能测试基线数据：P50 延迟 23ms，P99 延迟 187ms，QPS 峰值 12500，错误率 0.03%，内存占用 256MB，CPU 使用率 45%。这些数据来自 2024-12-15 的压测报告。" },
        { type: "filler", turns: 45, topic: "代码审查流程和Git分支管理策略" },
        {
            type: "checkpoint",
            probe: "之前的性能基线中，P99 延迟和 QPS 峰值分别是多少？",
            criteria: [
                { type: "keyword_present", value: "187", weight: 0.35 },
                { type: "keyword_present", value: "12500", weight: 0.35 },
                { type: "semantic_match", value: "P99 延迟是 187ms，QPS 峰值是 12500", weight: 0.3 },
            ],
        },
    ],
};

// ── 5. 跨话题关联（Cross-Association）─────────────────────────────

export const crossAssociation: BenchmarkScenario = {
    id: "cross-association",
    category: "cross_association",
    description: "跨话题关联：分别讨论 A、B 两个话题 → 填充 → 追问 A 和 B 的关联",
    steps: [
        // 话题 A
        { type: "user", content: "我们的认证系统使用 JWT，token 过期时间设置为 24 小时，刷新 token 有效期 7 天。签名算法用的 RS256。" },
        { type: "filler", turns: 15, topic: "日志系统和监控告警配置" },
        // 话题 B
        { type: "user", content: "API 网关层需要做请求限流，每个用户每分钟最多 100 次请求，超出返回 429 状态码。限流基于 Redis 的滑动窗口算法。" },
        { type: "filler", turns: 30, topic: "数据库索引优化和查询性能调优" },
        // 关联探测
        {
            type: "checkpoint",
            probe: "如果一个用户的 JWT token 过期了但还在疯狂请求，API 网关应该先返回什么状态码？token 过期时间和限流阈值分别是多少？",
            criteria: [
                { type: "keyword_present", value: "429", weight: 0.15 },
                { type: "keyword_present", value: "401", weight: 0.15 },
                { type: "keyword_present", value: "24", weight: 0.15 },
                { type: "keyword_present", value: "100", weight: 0.15 },
                { type: "semantic_match", value: "应该先检查限流(429)再检查认证(401)，或者先检查认证再检查限流", weight: 0.4 },
            ],
        },
    ],
};

// ── 导出全部场景 ─────────────────────────────────────────────────

export const ALL_SCENARIOS: BenchmarkScenario[] = [
    topicRecallBasic,
    topicRecallDeep,
    errorMemory,
    decisionConsistency,
    detailRetentionPaths,
    detailRetentionNumbers,
    crossAssociation,
];
