// ── agent-kit public API ────────────────────────────────────────
// Programmatic entry point for using agent-kit as a library.
// CLI users should use `agent-kit chat` or `agent-kit ask` commands.

// Kernel
export { Agent } from "./kernel/agent.js";
export type { AgentConfig } from "./kernel/agent.js";
export { AgentEvents } from "./kernel/events.js";
export type { AgentEvent } from "./kernel/events.js";
export { classifyError, AgentError, ErrorCategory } from "./kernel/errors.js";

// Tool system
export type { ToolDef, ToolResult, ToolContext } from "./tool/types.js";
export { ToolRegistry } from "./tool/registry.js";

// Plugin system
export type { Plugin, PluginContext, Logger } from "./plugin/types.js";
export { PluginManager } from "./plugin/manager.js";
export { codeToolsPlugin } from "./plugin/builtin.js";

// LLM Provider
export { LLMClient } from "./provider/client.js";
export { ModelRegistry } from "./provider/registry.js";
export { CostTracker } from "./provider/cost.js";
export { inferCapabilities, inferPricing } from "./provider/capabilities.js";
export type { ProviderProfile, TokenUsage, ToolCall, ModelCapabilities, ModelPricing } from "./provider/types.js";

// Config
export { loadConfig } from "./config/loader.js";
export { validateConfig, ApprovalPolicy } from "./config/config.js";

// Context
export { ContextManager } from "./context/manager.js";
export type { ContextManagerConfig, CompactResult } from "./context/manager.js";

// Permission
export { PermissionEngine } from "./permission/engine.js";
export { RuleStore } from "./permission/rules.js";
export type { PermissionMode, PermissionDecision, RiskLevel } from "./permission/types.js";

// Prompt
export { PromptEngine } from "./prompt/engine.js";
export { identityModule } from "./prompt/modules/identity.js";
export { environmentModule } from "./prompt/modules/environment.js";
export { behaviorModule } from "./prompt/modules/behavior.js";
export { developerModule } from "./prompt/modules/developer.js";
export { planningModule } from "./prompt/modules/planning.js";

// Loader
export { LoaderPipeline } from "./loader/pipeline.js";
export { fileLoader } from "./loader/loaders/file.js";
export { urlLoader } from "./loader/loaders/url.js";

// Workflow
export { WorkflowManager } from "./workflow/manager.js";
export type { WorkflowDef } from "./workflow/types.js";

// Subagent
export { BackgroundTaskManager } from "./subagent/background.js";
export { SubagentRunner } from "./subagent/runner.js";
export { DAGScheduler } from "./subagent/scheduler.js";
export type { DAGDef, DAGNode, DAGEdge } from "./subagent/types.js";

// Planner
export { Planner } from "./planner/planner.js";
export { PlanStore } from "./planner/store.js";
export type { PlanDef, PlanStep, StepStrategy } from "./planner/types.js";

// Sandbox
export { SandboxExecutor } from "./sandbox/executor.js";
export type { SandboxConfig } from "./sandbox/types.js";
export { defaultSandboxConfig } from "./sandbox/types.js";

// MCP
export { MCPManager } from "./mcp/manager.js";
export type { McpServerConfig } from "./mcp/types.js";

// Skill
export { SkillLoader } from "./skill/loader.js";

// Scaffold
export { ScaffoldGenerator } from "./scaffold/generator.js";

// UI (for custom UI consumers)
export { UIRegistry } from "./ui/registry.js";
export { getTheme } from "./ui/theme.js";
export { startApp } from "./ui/app.js";
