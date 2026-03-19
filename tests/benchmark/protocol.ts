// ── 黑盒基准测试协议 ─────────────────────────────────────────────
// 定义通用接口，任何 Agent CLI 都可以通过实现 Driver 参与评测

// ── 场景定义 ─────────────────────────────────────────────────────

export interface BenchmarkScenario {
    /** 场景唯一 ID */
    id: string;
    /** 测试的记忆能力类别 */
    category: MemoryCategory;
    /** 场景描述 */
    description: string;
    /** 对话步骤序列 */
    steps: ScenarioStep[];
}

export type MemoryCategory =
    | "topic_recall"          // 话题回温
    | "error_memory"          // 错误记忆
    | "decision_consistency"  // 决策一致性
    | "detail_retention"      // 细节保留
    | "cross_association";    // 跨话题关联

export type ScenarioStep =
    | { type: "user"; content: string }
    | { type: "checkpoint"; probe: string; criteria: CheckCriteria[] }
    | { type: "filler"; turns: number; topic: string };

/**
 * 检查点评分标准
 *  - keyword_present: 响应中必须包含某关键词
 *  - keyword_absent:  响应中不应包含某关键词（排除混淆）
 *  - semantic_match:  响应应语义相关（由评估器判定）
 *  - consistency:     与先前检查点的回答一致
 */
export interface CheckCriteria {
    type: "keyword_present" | "keyword_absent" | "semantic_match" | "consistency";
    value: string;
    weight: number; // 0-1, 该条标准在总分中的权重
}

// ── 驱动器接口 ──────────────────────────────────────────────────

export interface AgentDriver {
    /** 驱动器名称（如 "agent-kit", "kode-agent", "claude-code"） */
    name: string;
    /** 启动 Agent 会话 */
    start(): Promise<void>;
    /** 发送用户消息并获取 Agent 完整响应 */
    send(message: string): Promise<string>;
    /** 发送填充消息（大量无关对话消耗上下文） */
    sendFiller(topic: string, turns: number): Promise<void>;
    /** 关闭会话 */
    close(): Promise<void>;
}

// ── 评估结果 ─────────────────────────────────────────────────────

export interface CheckpointResult {
    /** 对应的 probe 问题 */
    probe: string;
    /** Agent 的实际响应 */
    response: string;
    /** 各条标准的得分 */
    criteriaScores: Array<{
        criterion: CheckCriteria;
        passed: boolean;
        detail: string;
    }>;
    /** 该检查点的加权总分（0-1） */
    score: number;
}

export interface ScenarioResult {
    scenarioId: string;
    category: MemoryCategory;
    description: string;
    checkpoints: CheckpointResult[];
    /** 场景总分（所有检查点的平均分） */
    totalScore: number;
    /** 运行耗时 ms */
    durationMs: number;
}

export interface BenchmarkReport {
    driverName: string;
    timestamp: string;
    scenarios: ScenarioResult[];
    /** 按类别汇总 */
    categoryScores: Record<MemoryCategory, { avg: number; count: number }>;
    /** 总分（所有场景平均） */
    overallScore: number;
}
