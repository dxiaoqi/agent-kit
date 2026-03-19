// ── UIRegistry ───────────────────────────────────────────────────
// 管理六种 UI 插槽的注册与查找。
// 通过 React Context 在组件树中传递。

import type {
    ToolRendererDef,
    PermissionRendererDef,
    ContentRendererDef,
    MarkdownExtensionDef,
    InputModeDef,
    StatusBarItemDef,
} from "./slots.js";

export class UIRegistry {
    private readonly toolRenderers = new Map<string, ToolRendererDef>();
    private readonly permRenderers = new Map<string, PermissionRendererDef>();
    private readonly contentRenderers = new Map<string, ContentRendererDef>();
    private readonly markdownExts: MarkdownExtensionDef[] = [];
    private readonly inputModes = new Map<string, InputModeDef>();
    private readonly statusBarItems: StatusBarItemDef[] = [];

    registerToolRenderer(r: ToolRendererDef): void {
        this.toolRenderers.set(r.toolName, r);
    }

    registerPermissionRenderer(r: PermissionRendererDef): void {
        this.permRenderers.set(r.toolName, r);
    }

    registerContentRenderer(r: ContentRendererDef): void {
        this.contentRenderers.set(r.blockType, r);
    }

    registerMarkdownExtension(ext: MarkdownExtensionDef): void {
        this.markdownExts.push(ext);
    }

    registerInputMode(mode: InputModeDef): void {
        this.inputModes.set(mode.name, mode);
    }

    registerStatusBarItem(item: StatusBarItemDef): void {
        this.statusBarItems.push(item);
        this.statusBarItems.sort((a, b) => a.priority - b.priority);
    }

    getToolRenderer(toolName: string): ToolRendererDef | undefined {
        return this.toolRenderers.get(toolName);
    }

    getPermissionRenderer(toolName: string): PermissionRendererDef | undefined {
        return this.permRenderers.get(toolName);
    }

    getContentRenderer(blockType: string): ContentRendererDef | undefined {
        return this.contentRenderers.get(blockType);
    }

    getMarkdownExtensions(): MarkdownExtensionDef[] {
        return this.markdownExts;
    }

    getInputModes(): InputModeDef[] {
        return Array.from(this.inputModes.values());
    }

    getStatusBarItems(): StatusBarItemDef[] {
        return this.statusBarItems;
    }
}
