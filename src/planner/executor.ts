// ── PlanExecutor：已废弃 ──────────────────────────────────────────
// 原 PlanExecutor 在 tool.execute() 内部调用 agent.run()，
// 导致整个多步执行在一次 tool call 内完成，UI 无法观察进度。
//
// 新设计：计划执行由主 Agent 循环驱动，每步走正常的工具调用 + 权限审批流。
// 状态管理移至 PlanStore（.agent/plans/ 持久化）。
//
// 此文件保留为向后兼容，实际逻辑已移至 store.ts + tool.ts。

export {};
