// ── Agent 事件协议 ───────────────────────────────────────────────
// AgentEvent 使用 discriminated union，UI 层通过 switch(event.type) 消费。

import type { TokenUsage, ToolCall } from "../provider/types.js";
import type { ToolResult } from "../tool/types.js";

export type AgentEvent =
    | AgentEvent.AgentStart
    | AgentEvent.TextDelta
    | AgentEvent.TextComplete
    | AgentEvent.ToolCallStart
    | AgentEvent.ToolCallComplete
    | AgentEvent.ToolCallError
    | AgentEvent.PermissionRequest
    | AgentEvent.ContextCompact
    | AgentEvent.CostUpdate
    | AgentEvent.ModelSwitch
    | AgentEvent.TaskStart
    | AgentEvent.TaskComplete
    | AgentEvent.PlanCreated
    | AgentEvent.PlanStepStart
    | AgentEvent.PlanStepComplete
    | AgentEvent.PlanComplete
    | AgentEvent.AgentEnd
    | AgentEvent.AgentError;

export namespace AgentEvent {
    export interface AgentStart {
        type: "agent_start";
        modelId: string;
    }

    export interface TextDelta {
        type: "text_delta";
        text: string;
    }

    export interface TextComplete {
        type: "text_complete";
        text: string;
    }

    export interface ToolCallStart {
        type: "tool_call_start";
        callId: string;
        name: string;
        args: Record<string, unknown>;
    }

    export interface ToolCallComplete {
        type: "tool_call_complete";
        callId: string;
        name: string;
        result: ToolResult;
    }

    export interface ToolCallError {
        type: "tool_call_error";
        callId: string;
        name: string;
        error: string;
    }

    export interface PermissionRequest {
        type: "permission_request";
        id: string;
        toolName: string;
        args: Record<string, unknown>;
        riskLevel: "low" | "moderate" | "high";
    }

    export interface ContextCompact {
        type: "context_compact";
        summary: string;
        tokensBefore: number;
        tokensAfter: number;
    }

    export interface CostUpdate {
        type: "cost_update";
        totalCost: number;
        turnCost: number;
    }

    export interface ModelSwitch {
        type: "model_switch";
        fromModel: string;
        toModel: string;
    }

    export interface TaskStart {
        type: "task_start";
        taskId: string;
        goal: string;
        background: boolean;
    }

    export interface TaskComplete {
        type: "task_complete";
        taskId: string;
        success: boolean;
        durationMs?: number;
    }

    export interface PlanCreated {
        type: "plan_created";
        planId: string;
        goal: string;
        stepCount: number;
        filePath: string;
    }

    export interface PlanStepStart {
        type: "plan_step_start";
        planId: string;
        stepId: string;
        stepTitle: string;
        stepIndex: number;
        totalSteps: number;
    }

    export interface PlanStepComplete {
        type: "plan_step_complete";
        planId: string;
        stepId: string;
        stepTitle: string;
        result: "completed" | "failed" | "skipped";
        durationMs?: number;
    }

    export interface PlanComplete {
        type: "plan_complete";
        planId: string;
        success: boolean;
        completedSteps: number;
        failedSteps: number;
        totalSteps: number;
    }

    export interface AgentEnd {
        type: "agent_end";
        turnCount: number;
        usage?: TokenUsage;
        cost?: number;
    }

    export interface AgentError {
        type: "agent_error";
        error: string;
        retryable: boolean;
    }
}

// ── 工厂函数 ─────────────────────────────────────────────────────

export const AgentEvents = {
    start: (modelId: string): AgentEvent.AgentStart =>
        ({ type: "agent_start", modelId }),

    textDelta: (text: string): AgentEvent.TextDelta =>
        ({ type: "text_delta", text }),

    textComplete: (text: string): AgentEvent.TextComplete =>
        ({ type: "text_complete", text }),

    toolCallStart: (call: ToolCall): AgentEvent.ToolCallStart =>
        ({ type: "tool_call_start", callId: call.callId, name: call.name, args: call.args }),

    toolCallComplete: (callId: string, name: string, result: ToolResult): AgentEvent.ToolCallComplete =>
        ({ type: "tool_call_complete", callId, name, result }),

    toolCallError: (callId: string, name: string, error: string): AgentEvent.ToolCallError =>
        ({ type: "tool_call_error", callId, name, error }),

    permissionRequest: (
        id: string,
        toolName: string,
        args: Record<string, unknown>,
        riskLevel: "low" | "moderate" | "high",
    ): AgentEvent.PermissionRequest =>
        ({ type: "permission_request", id, toolName, args, riskLevel }),

    contextCompact: (summary: string, tokensBefore: number, tokensAfter: number): AgentEvent.ContextCompact =>
        ({ type: "context_compact", summary, tokensBefore, tokensAfter }),

    taskStart: (taskId: string, goal: string, background: boolean): AgentEvent.TaskStart =>
        ({ type: "task_start", taskId, goal, background }),

    taskComplete: (taskId: string, success: boolean, durationMs?: number): AgentEvent.TaskComplete =>
        ({ type: "task_complete", taskId, success, durationMs }),

    planCreated: (planId: string, goal: string, stepCount: number, filePath: string): AgentEvent.PlanCreated =>
        ({ type: "plan_created", planId, goal, stepCount, filePath }),

    planStepStart: (planId: string, stepId: string, stepTitle: string, stepIndex: number, totalSteps: number): AgentEvent.PlanStepStart =>
        ({ type: "plan_step_start", planId, stepId, stepTitle, stepIndex, totalSteps }),

    planStepComplete: (planId: string, stepId: string, stepTitle: string, result: "completed" | "failed" | "skipped", durationMs?: number): AgentEvent.PlanStepComplete =>
        ({ type: "plan_step_complete", planId, stepId, stepTitle, result, durationMs }),

    planComplete: (planId: string, success: boolean, completedSteps: number, failedSteps: number, totalSteps: number): AgentEvent.PlanComplete =>
        ({ type: "plan_complete", planId, success, completedSteps, failedSteps, totalSteps }),

    end: (turnCount: number, usage?: TokenUsage, cost?: number): AgentEvent.AgentEnd =>
        ({ type: "agent_end", turnCount, usage, cost }),

    error: (error: string, retryable = false): AgentEvent.AgentError =>
        ({ type: "agent_error", error, retryable }),
} as const;
