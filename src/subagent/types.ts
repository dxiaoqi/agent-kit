// ── Subagent DAG 类型定义 ─────────────────────────────────────────
// 子代理以 DAG 图组织：节点是独立 Agent 实例，边是数据依赖。
// DAGScheduler 按拓扑排序分层，同层并发执行。

// ── DAG 图定义 ──────────────────────────────────────────────────

export interface DAGDef {
    nodes: DAGNode[];
    edges: DAGEdge[];
}

export interface DAGNode {
    /** 节点唯一 ID */
    id: string;
    /** 引用 SubagentTypeDef.name */
    type: string;
    /** 传给子代理的目标 prompt */
    goal: string;
    /** 节点级配置覆盖 */
    config?: DAGNodeConfig;
}

export interface DAGNodeConfig {
    /** 模型 profile 名称（可选，默认用 subagent binding） */
    model?: string;
    /** 允许使用的工具子集（不设则继承父 Agent 的全部工具） */
    allowedTools?: string[];
    /** 最大轮次 */
    maxTurns?: number;
    /** 是否只读 */
    readOnly?: boolean;
}

export interface DAGEdge {
    from: string;
    to: string;
    /** 条件表达式（可选，true 时才传递数据） */
    condition?: string;
}

// ── 子代理类型定义 ──────────────────────────────────────────────

export interface SubagentTypeDef {
    name: string;
    description: string;
    /** 默认配置 */
    defaultConfig?: DAGNodeConfig;
}

// ── 执行结果 ────────────────────────────────────────────────────

export type NodeStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface NodeResult {
    nodeId: string;
    status: NodeStatus;
    output?: string;
    error?: string;
    durationMs?: number;
    tokenUsage?: { prompt: number; completion: number; total: number };
}

export interface DAGResult {
    nodeResults: Map<string, NodeResult>;
    totalDurationMs: number;
    success: boolean;
}

// ── DAG 触发器 ──────────────────────────────────────────────────

export interface DAGTrigger {
    /** 触发输入（传给根节点的上下文） */
    input: string;
    /** 父 Agent 的工作目录 */
    cwd: string;
}

// ── 节点间消息 ──────────────────────────────────────────────────

export interface BusMessage {
    from: string;
    to: string;
    type: "data" | "error" | "signal";
    payload: string;
    timestamp: number;
}
