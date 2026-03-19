// ── Plan 系统类型定义 ─────────────────────────────────────────────
// Plan = 结构化的执行计划，由 LLM 根据用户意图自动生成。
//
// 核心理念：
//   用户给出高层意图（"帮我把项目从 JS 迁移到 TS"）
//   → Planner 分析项目状态 + 可用能力
//   → 生成 PlanDef（步骤 + 依赖 + 工具/模型配置）
//   → PlanExecutor 按依赖顺序编排执行
//   → 每步完成后动态评估是否需要调整计划

import type { DAGNodeConfig } from "../subagent/types.js";

// ── 计划定义 ────────────────────────────────────────────────────

export interface PlanDef {
    /** 计划 ID */
    id: string;
    /** 用户原始意图 */
    goal: string;
    /** 计划摘要 */
    summary: string;
    /** 有序步骤（steps[i].dependsOn 引用前面步骤的 id） */
    steps: PlanStep[];
    /** 全局上下文（所有步骤共享） */
    context?: string;
}

export interface PlanStep {
    /** 步骤 ID */
    id: string;
    /** 步骤描述（给用户看） */
    title: string;
    /** 详细指令（给 agent/subagent 执行） */
    instruction: string;
    /** 执行策略 */
    strategy: StepStrategy;
    /** 依赖的步骤 ID（这些步骤完成后才能开始） */
    dependsOn: string[];
    /** 完成条件（自然语言描述，用于评估） */
    acceptance?: string;
    /** 子代理配置覆盖 */
    config?: DAGNodeConfig;
}

/** 步骤执行策略 */
export type StepStrategy =
    | "agent"       // 主 agent 直接执行（默认，适合简单操作）
    | "subagent"    // 新建子代理执行（适合独立任务）
    | "parallel"    // 此步骤的 instruction 包含多个可并行的子任务
    | "workflow";   // 切换工作流后执行

// ── 计划执行状态 ────────────────────────────────────────────────

export type PlanStatus = "draft" | "running" | "paused" | "completed" | "failed";
export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface PlanState {
    plan: PlanDef;
    status: PlanStatus;
    stepStates: Map<string, StepState>;
    startedAt: number;
    completedAt?: number;
}

export interface StepState {
    stepId: string;
    status: StepStatus;
    output?: string;
    error?: string;
    startedAt?: number;
    completedAt?: number;
}

// ── Planner 生成请求 ────────────────────────────────────────────

export interface PlanRequest {
    /** 用户意图 */
    goal: string;
    /** 当前工作目录 */
    cwd: string;
    /** 可用工具名列表（Planner 据此规划步骤） */
    availableTools: string[];
    /** 可用工作流列表 */
    availableWorkflows: string[];
    /** 可用子代理类型 */
    availableSubagents: string[];
    /** 额外上下文（如项目结构、最近的对话摘要） */
    extraContext?: string;
}
