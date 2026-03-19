// ── PluginManager ────────────────────────────────────────────────
// 管理 Plugin 的注册、生命周期和钩子分发。
// 各注册项存储在独立的 Map 中，供 Kernel 各子系统查询。

import type {
    Plugin,
    PluginContext,
    Logger,
    ToolRegistration,
    ProviderRegistration,
    LoaderRegistration,
    PromptModuleRegistration,
    WorkflowRegistration,
    SubagentTypeRegistration,
    ToolRendererRegistration,
    PermissionRendererRegistration,
    ContentRendererRegistration,
    MarkdownExtensionRegistration,
    InputModeRegistration,
    StatusBarItemRegistration,
} from "./types.js";

type EventHandler = (...args: unknown[]) => void;

export class PluginManager {
    private readonly plugins: Plugin[] = [];
    private readonly eventHandlers = new Map<string, EventHandler[]>();

    // ── 各类注册表 ──
    readonly tools             = new Map<string, ToolRegistration>();
    readonly providers         = new Map<string, ProviderRegistration>();
    readonly loaders:            LoaderRegistration[] = [];
    readonly promptModules     = new Map<string, PromptModuleRegistration>();
    readonly workflows         = new Map<string, WorkflowRegistration>();
    readonly subagentTypes     = new Map<string, SubagentTypeRegistration>();

    // UI 插槽
    readonly toolRenderers     = new Map<string, ToolRendererRegistration>();
    readonly permRenderers     = new Map<string, PermissionRendererRegistration>();
    readonly contentRenderers  = new Map<string, ContentRendererRegistration>();
    readonly markdownExtensions: MarkdownExtensionRegistration[] = [];
    readonly inputModes        = new Map<string, InputModeRegistration>();
    readonly statusBarItems:     StatusBarItemRegistration[] = [];

    constructor(
        private readonly config: Record<string, unknown>,
        private readonly logger: Logger,
    ) {}

    // ── 注册 Plugin ─────────────────────────────────────────────

    async register(plugin: Plugin): Promise<void> {
        this.logger.info(`Loading plugin: ${plugin.name}@${plugin.version}`);

        const ctx = this.createContext(plugin.name);
        await plugin.setup(ctx);

        this.plugins.push(plugin);
        this.logger.info(`Plugin loaded: ${plugin.name}`);
    }

    // ── 卸载所有 Plugin ─────────────────────────────────────────

    async teardownAll(): Promise<void> {
        for (const plugin of this.plugins.reverse()) {
            try {
                await plugin.teardown?.();
            } catch (err) {
                this.logger.error(`Error tearing down plugin ${plugin.name}: ${err}`);
            }
        }
        this.plugins.length = 0;
    }

    // ── 事件分发 ────────────────────────────────────────────────

    emit(event: string, ...args: unknown[]): void {
        const handlers = this.eventHandlers.get(event);
        if (!handlers) return;
        for (const handler of handlers) {
            try {
                handler(...args);
            } catch (err) {
                this.logger.error(`Event handler error [${event}]: ${err}`);
            }
        }
    }

    // ── 内部：为每个 Plugin 创建隔离的 PluginContext ─────────────

    private createContext(pluginName: string): PluginContext {
        const pm = this;

        return {
            registerTool(tool) {
                if (pm.tools.has(tool.name)) {
                    pm.logger.warn(`[${pluginName}] Overwriting tool: ${tool.name}`);
                }
                pm.tools.set(tool.name, tool);
            },

            registerProvider(provider) {
                pm.providers.set(provider.name, provider);
            },

            registerLoader(loader) {
                pm.loaders.push(loader);
            },

            registerPromptModule(module) {
                pm.promptModules.set(module.id, module);
            },

            registerWorkflow(workflow) {
                pm.workflows.set(workflow.name, workflow);
            },

            registerSubagentType(type) {
                pm.subagentTypes.set(type.name, type);
            },

            // UI 插槽
            registerToolRenderer(renderer) {
                pm.toolRenderers.set(renderer.toolName, renderer);
            },

            registerPermissionRenderer(renderer) {
                pm.permRenderers.set(renderer.toolName, renderer);
            },

            registerContentRenderer(renderer) {
                pm.contentRenderers.set(renderer.blockType, renderer);
            },

            registerMarkdownExtension(extension) {
                pm.markdownExtensions.push(extension);
            },

            registerInputMode(mode) {
                pm.inputModes.set(mode.name, mode);
            },

            registerStatusBarItem(item) {
                pm.statusBarItems.push(item);
                pm.statusBarItems.sort((a, b) => a.priority - b.priority);
            },

            // 事件
            on(event: string, handler: (...args: unknown[]) => void) {
                if (!pm.eventHandlers.has(event)) {
                    pm.eventHandlers.set(event, []);
                }
                pm.eventHandlers.get(event)!.push(handler);
            },

            // 只读访问
            getConfig() {
                return pm.config;
            },

            getLogger() {
                return pm.logger;
            },
        };
    }

    // ── 查询 API ────────────────────────────────────────────────

    getPluginNames(): string[] {
        return this.plugins.map(p => p.name);
    }

    hasTool(name: string): boolean {
        return this.tools.has(name);
    }

    hasProvider(name: string): boolean {
        return this.providers.has(name);
    }
}
