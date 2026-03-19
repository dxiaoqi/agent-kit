import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "./config/loader.js";
import { validateConfig } from "./config/config.js";
import { Agent as NewAgent, type AgentConfig } from "./kernel/agent.js";
import type { AgentEvent } from "./kernel/events.js";
import { LLMClient } from "./provider/client.js";
import { ModelRegistry } from "./provider/registry.js";
import { CostTracker } from "./provider/cost.js";
import { inferCapabilities, inferPricing } from "./provider/capabilities.js";
import { ToolRegistry } from "./tool/registry.js";
import { PluginManager } from "./plugin/manager.js";
import { codeToolsPlugin } from "./plugin/builtin.js";
import { PromptEngine } from "./prompt/engine.js";
import { identityModule } from "./prompt/modules/identity.js";
import { environmentModule } from "./prompt/modules/environment.js";
import { behaviorModule } from "./prompt/modules/behavior.js";
import { developerModule } from "./prompt/modules/developer.js";
import { getTheme } from "./ui/theme.js";
import { UIRegistry } from "./ui/registry.js";
import { startApp } from "./ui/app.js";
import * as os from "os";
import { PermissionEngine } from "./permission/engine.js";
import { RuleStore } from "./permission/rules.js";
import { ApprovalPolicy } from "./config/config.js";
import { LoaderPipeline } from "./loader/pipeline.js";
import { fileLoader } from "./loader/loaders/file.js";
import { urlLoader } from "./loader/loaders/url.js";
import { WorkflowManager } from "./workflow/manager.js";
import { codeWorkflow } from "./workflow/builtin/code.js";
import { researchWorkflow } from "./workflow/builtin/research.js";
import { BackgroundTaskManager } from "./subagent/background.js";
import { injectTaskDeps } from "./tool/builtin/task.js";
import { injectTaskOutputDeps } from "./tool/builtin/task_output.js";
import { MCPManager } from "./mcp/manager.js";
import { SkillLoader } from "./skill/loader.js";
import { loadSkillTool, injectSkillLoader } from "./skill/tool.js";
import { join } from "node:path";
import { SandboxExecutor } from "./sandbox/executor.js";
import type { SandboxConfig } from "./sandbox/types.js";
import { defaultSandboxConfig } from "./sandbox/types.js";
import { injectSandboxExecutor } from "./tool/builtin/bash.js";
import { planTool, planApproveTool, planStepDoneTool, planStatusTool, injectPlanDeps, injectPlanStore } from "./planner/tool.js";
import { PlanStore } from "./planner/store.js";
import { scaffoldTool, injectScaffoldDeps } from "./scaffold/tool.js";
import { planningModule } from "./prompt/modules/planning.js";

// ── CLI setup ─────────────────────────────────────────────────────

const program = new Command();

program
  .name("agent")
  .description("agent-kit — multi-model CLI agent")
  .version("0.1.0");

program
  .command("chat", { isDefault: true })
  .description("Start interactive chat session")
  .option("-m, --model <profile>", "Override model profile")
  .option("--theme <name>", "Color theme (dark/light)", "dark")
  .action((opts) => runInteractive(opts));

program
  .command("ask <message>")
  .description("Run a single message and exit")
  .option("-m, --model <profile>", "Override model profile")
  .action((message, opts) => runSingle(message, opts));

program.parse(process.argv);

// ── Shared bootstrap ─────────────────────────────────────────────

interface BootstrapResult {
  agent: NewAgent;
  llmClient: LLMClient;
  pluginManager: PluginManager;
  uiRegistry: UIRegistry;
  config: ReturnType<typeof loadConfig>;
  modelId: string;
  workflowManager: WorkflowManager;
  loaderPipeline: LoaderPipeline;
  promptEngine: PromptEngine;
  costTracker: CostTracker;
  modelRegistry: ModelRegistry;
  mcpManager: MCPManager;
  skillLoader: SkillLoader;
}

async function bootstrap(opts: { model?: string }): Promise<BootstrapResult> {
  let config;
  try {
    config = loadConfig(process.cwd());
  } catch (err: any) {
    console.error(chalk.red(`Config error: ${err.message}`));
    process.exit(1);
  }

  const errors = validateConfig(config);
  if (errors.length > 0) {
    for (const e of errors) console.error(chalk.red(`  ✗  ${e}`));
    process.exit(1);
  }

  const modelId = opts.model ?? config.defaultModel ?? "default";
  const rawModels = config.models as Record<string, any>;

  if (!rawModels?.[modelId]) {
    console.error(chalk.red(`Unknown model profile: ${modelId}`));
    console.error(chalk.dim(`Available: ${Object.keys(rawModels ?? {}).join(", ")}`));
    process.exit(1);
  }

  // 为每个 profile 自动推断 capabilities 和 pricing
  const enrichedModels: Record<string, any> = {};
  for (const [id, profile] of Object.entries(rawModels)) {
    enrichedModels[id] = {
      ...profile,
      capabilities: profile.capabilities ?? inferCapabilities(profile.name),
      pricing: profile.pricing ?? inferPricing(profile.name),
    };
  }

  // ModelRegistry + CostTracker + LLMClient
  const modelRegistry = new ModelRegistry(
    enrichedModels,
    config.modelBindings as Record<string, string>,
    modelId,
  );
  const costTracker = new CostTracker();
  const llmClient = new LLMClient(modelRegistry, { maxRetries: 3 }, costTracker);
  const modelProfile = modelRegistry.get(modelId);

  // Plugin Manager + UIRegistry
  const logger = {
    debug: (...args: unknown[]) => { if (process.env.DEBUG) console.debug(chalk.dim("[debug]"), ...args); },
    info: (...args: unknown[]) => console.log(chalk.blue("[info]"), ...args),
    warn: (...args: unknown[]) => console.warn(chalk.yellow("[warn]"), ...args),
    error: (...args: unknown[]) => console.error(chalk.red("[error]"), ...args),
  };
  const pluginManager = new PluginManager(config as any, logger);
  const uiRegistry = new UIRegistry();

  // Register built-in tools plugin
  const toolRegistry = new ToolRegistry();
  codeToolsPlugin.setup({
    registerTool: (tool) => toolRegistry.register(tool as any),
    registerProvider: () => {},
    registerLoader: () => {},
    registerPromptModule: () => {},
    registerWorkflow: () => {},
    registerSubagentType: () => {},
    registerToolRenderer: (r) => uiRegistry.registerToolRenderer(r as any),
    registerPermissionRenderer: (r) => uiRegistry.registerPermissionRenderer(r as any),
    registerContentRenderer: (r) => uiRegistry.registerContentRenderer(r as any),
    registerMarkdownExtension: (ext) => uiRegistry.registerMarkdownExtension(ext as any),
    registerInputMode: (mode) => uiRegistry.registerInputMode(mode as any),
    registerStatusBarItem: (item) => uiRegistry.registerStatusBarItem(item as any),
    on: () => {},
    getConfig: () => config as any,
    getLogger: () => logger,
  });

  // Prompt Engine
  const promptEngine = new PromptEngine();
  promptEngine.register(identityModule);
  promptEngine.register(environmentModule);
  promptEngine.register(behaviorModule);
  promptEngine.register(developerModule);
  promptEngine.register(planningModule);

  // Loader Pipeline
  const cwd = config.cwd ?? process.cwd();
  const loaderPipeline = new LoaderPipeline({ cwd });
  loaderPipeline.register(fileLoader);
  loaderPipeline.register(urlLoader);

  // Workflow Manager
  const workflowManager = new WorkflowManager(
    promptEngine,
    toolRegistry,
    () => ({
      cwd,
      getConfig: () => config as Record<string, unknown>,
      getToolNames: () => toolRegistry.list(),
    }),
  );
  workflowManager.register(codeWorkflow);
  workflowManager.register(researchWorkflow);

  // 激活配置中指定的工作流
  if (config.workflow) {
    try {
      await workflowManager.activate(config.workflow);
      logger.info(`Activated workflow: ${config.workflow}`);
    } catch (err: any) {
      logger.warn(`Failed to activate workflow "${config.workflow}": ${err.message}`);
    }
  }

  // ── MCP Servers ────────────────────────────────────────────────
  const mcpManager = new MCPManager({ cwd });
  mcpManager.loadConfig();
  const mcpServerCount = Object.keys(mcpManager.loadConfig().mcpServers).length;
  if (mcpServerCount > 0) {
    logger.info(`Connecting to ${mcpServerCount} MCP server(s)...`);
    const { connected, failed } = await mcpManager.connectAll();
    if (connected.length > 0) {
      const toolCount = mcpManager.registerTools(toolRegistry);
      logger.info(`MCP: ${connected.length} server(s) connected, ${toolCount} tool(s) registered`);
    }
    for (const name of failed) {
      logger.warn(`MCP server "${name}" failed to connect`);
    }
  }

  // ── Skills ────────────────────────────────────────────────────
  const skillDirs = (config.skillDirs ?? [".agent/skills"]).map(d =>
    d.startsWith("/") || d.startsWith("~") ? d : join(cwd, d),
  );
  const skillLoader = new SkillLoader(skillDirs);
  if (skillLoader.size > 0) {
    injectSkillLoader(skillLoader);
    toolRegistry.register(loadSkillTool as any);
    logger.info(`Loaded ${skillLoader.size} skill(s): ${skillLoader.list().join(", ")}`);
  }

  // ── Sandbox ───────────────────────────────────────────────────
  const rawSandbox = (config as any).sandbox ?? {};
  const sandboxCfg: SandboxConfig = {
    ...defaultSandboxConfig,
    ...rawSandbox,
    filesystem: { ...defaultSandboxConfig.filesystem, ...(rawSandbox.filesystem ?? {}) },
    network:    { ...defaultSandboxConfig.network,    ...(rawSandbox.network ?? {}) },
    docker:     { ...defaultSandboxConfig.docker,     ...(rawSandbox.docker ?? {}) },
  };
  const sandboxExecutor = new SandboxExecutor(sandboxCfg);

  if (sandboxCfg.enabled) {
    injectSandboxExecutor(sandboxExecutor);
    const info = sandboxExecutor.getInfo();
    if (info.activeStrategy !== "none") {
      logger.info(`Sandbox: ${info.permissions} mode, strategy=${info.activeStrategy} on ${info.platform}`);
    } else {
      logger.warn(`Sandbox: enabled but no strategy available on ${info.platform}. ${sandboxExecutor.getInstallHint()}`);
    }

    // Docker image pre-pull (non-blocking)
    if (sandboxCfg.docker.pullOnStart && info.available.docker) {
      sandboxExecutor.getDockerStrategy()?.ensureImage(sandboxCfg.docker.image)
        .then(ok => { if (!ok) logger.warn(`Failed to pull Docker image: ${sandboxCfg.docker.image}`); });
    }
  }

  const promptCtx = {
    cwd,
    os: `${os.platform()} ${os.release()}`,
    shell: process.env.SHELL ?? "bash",
    date: new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
    toolNames: toolRegistry.list(),
    developerInstructions: (config as any).developerInstructions,
    extraContext: workflowManager.getActive()?.extraContext,
    skillDescriptions: skillLoader.size > 0 ? skillLoader.getDescriptions() : undefined,
    sandboxInfo: {
      mode: sandboxCfg.enabled ? sandboxCfg.permissions : "off",
      available: sandboxExecutor.isSandboxAvailable(),
      platform: sandboxExecutor.getInfo().platform,
    },
  };

  const systemPrompt = promptEngine.build(promptCtx);

  // Permission Engine
  const ruleStore = new RuleStore();
  const permissionEngine = new PermissionEngine(ruleStore, cwd);

  // 从 config.toml 加载权限规则
  if (config.permissionRules.length > 0) {
    ruleStore.loadFromConfig(config.permissionRules);
    logger.info(`Loaded ${config.permissionRules.length} permission rule(s) from config`);
  }

  // 从 config.toml 加载自定义安全规则
  if (config.safetyRules.length > 0) {
    const { loaded, errors } = permissionEngine.loadSafetyRulesFromConfig(config.safetyRules);
    if (loaded > 0) {
      logger.info(`Loaded ${loaded} custom safety rule(s) from config`);
    }
    for (const e of errors) {
      logger.warn(`Safety rule config error: ${e}`);
    }
  }

  // 根据配置设置初始权限模式
  if (config.approval === ApprovalPolicy.AUTO) {
    permissionEngine.setMode("bypassPermissions");
  } else if (config.approval === ApprovalPolicy.DENY) {
    permissionEngine.setMode("denyAll");
  }

  // 沙箱与权限引擎集成（对齐 Claude Code 双模式）
  if (sandboxCfg.enabled && sandboxExecutor.isSandboxAvailable()) {
    permissionEngine.configureSandbox(
      sandboxCfg.permissions === "auto-allow",
      (cmd) => sandboxExecutor.willSandbox(cmd),
    );
  }

  const agentConfig: AgentConfig = {
    systemPrompt,
    profile: {
      name: modelProfile.name,
      apiKey: modelProfile.apiKey,
      baseUrl: modelProfile.baseUrl,
      temperature: modelProfile.temperature ?? 0.7,
      contextWindow: modelProfile.contextWindow ?? 128000,
      maxTokens: modelProfile.maxTokens,
    },
    maxTurns: config.maxTurns ?? 0,        // 0 = unlimited
    permissionEngine,
    workflowManager,
  };

  const agent = new NewAgent(agentConfig, llmClient, toolRegistry);

  // Subagent / Task system
  const taskManager = new BackgroundTaskManager();
  const runnerDeps = {
    llm: llmClient,
    parentTools: toolRegistry,
    baseProfile: agentConfig.profile,
    cwd,
    registry: modelRegistry,
  };
  injectTaskDeps(runnerDeps, taskManager);
  injectTaskOutputDeps(taskManager);

  // Plan tools
  const planStore = new PlanStore(cwd);
  injectPlanStore(planStore);
  injectPlanDeps({
    llm: llmClient,
    profile: agentConfig.profile,
    toolRegistry,
    workflowManager,
    subagentNames: [],
  });
  toolRegistry.register(planTool as any);
  toolRegistry.register(planApproveTool as any);
  toolRegistry.register(planStepDoneTool as any);
  toolRegistry.register(planStatusTool as any);

  // Scaffold tool
  toolRegistry.register(scaffoldTool as any);
  injectScaffoldDeps({
    llm: llmClient,
    profile: agentConfig.profile,
    cwd,
  });

  return { agent, llmClient, pluginManager, uiRegistry, config, modelId, workflowManager, loaderPipeline, promptEngine, costTracker, modelRegistry, mcpManager, skillLoader };
}

// ── Interactive mode (Ink) ───────────────────────────────────────

async function runInteractive(opts: { model?: string; theme?: string }) {
  const { agent, llmClient, uiRegistry, modelId, mcpManager } = await bootstrap(opts);
  const theme = getTheme(opts.theme);

  process.on("SIGINT", async () => {
    agent.abort();
    agent.close();
    await mcpManager.disconnectAll();
    await llmClient.close();
    process.exit(0);
  });

  const app = startApp(agent, modelId, theme, uiRegistry);
  await app.waitUntilExit();
  agent.close();
  await mcpManager.disconnectAll();
  await llmClient.close();
}

// ── Single-shot mode (plain text) ────────────────────────────────

async function runSingle(message: string, opts: { model?: string }) {
  const { agent, llmClient } = await bootstrap(opts);

  for await (const event of agent.run(message)) {
    handlePlainEvent(event);
  }

  agent.close();
  await llmClient.close();
}

function handlePlainEvent(event: AgentEvent): void {
  switch (event.type) {
    case "text_delta":
      process.stdout.write(event.text);
      break;
    case "text_complete":
      process.stdout.write("\n");
      break;
    case "tool_call_start":
      console.log(chalk.dim(`⏺ ${event.name}(${JSON.stringify(event.args).slice(0, 80)})`));
      break;
    case "tool_call_complete":
      if (event.result.success) {
        console.log(chalk.dim(`✓ ${event.name} → ${event.result.output.slice(0, 100)}`));
      }
      break;
    case "tool_call_error":
      console.error(chalk.red(`✗ ${event.name}: ${event.error}`));
      break;
    case "permission_request":
      console.log(chalk.yellow(`⚠ Permission request: ${event.toolName} [${event.riskLevel}]`));
      break;
    case "task_start":
      console.log(chalk.cyan(`▶ Task ${event.taskId}: ${event.goal}${event.background ? " (background)" : ""}`));
      break;
    case "task_complete":
      console.log(chalk[event.success ? "green" : "red"](`■ Task ${event.taskId}: ${event.success ? "completed" : "failed"}${event.durationMs ? ` (${(event.durationMs / 1000).toFixed(1)}s)` : ""}`));
      break;
    case "context_compact":
      console.log(chalk.yellow(`⟳ Context compacted: ${event.tokensBefore} → ${event.tokensAfter} tokens`));
      break;
    case "plan_created":
      console.log(chalk.cyan(`📋 Plan created: ${event.goal} (${event.stepCount} steps) → ${event.filePath}`));
      break;
    case "plan_step_start":
      console.log(chalk.cyan(`▶ Plan step ${event.stepIndex}/${event.totalSteps}: ${event.stepTitle}`));
      break;
    case "plan_step_complete": {
      const stepIcon = event.result === "completed" ? "✓" : event.result === "failed" ? "✗" : "⊘";
      const stepColor = event.result === "completed" ? "green" : event.result === "failed" ? "red" : "dim";
      const stepDur = event.durationMs ? ` [${(event.durationMs / 1000).toFixed(1)}s]` : "";
      console.log(chalk[stepColor](`${stepIcon} ${event.stepTitle} — ${event.result}${stepDur}`));
      break;
    }
    case "plan_complete": {
      const planColor = event.success ? "green" : "red";
      console.log(chalk[planColor](`${event.success ? "✓" : "✗"} Plan ${event.success ? "completed" : "failed"}: ${event.completedSteps}/${event.totalSteps} steps`));
      break;
    }
    case "agent_error":
      console.error(chalk.red(event.error));
      break;
    case "agent_end":
      if (event.usage) {
        const costStr = event.cost != null && event.cost > 0 ? ` | Cost: $${event.cost.toFixed(4)}` : "";
        console.log(chalk.dim(`Tokens: ${event.usage.totalTokens} | Turns: ${event.turnCount}${costStr}`));
      }
      break;
  }
}
