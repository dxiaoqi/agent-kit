// ── ModelRegistry：模型注册表 + 角色路由 ─────────────────────────
// 管理多个模型 profile，按角色（main/compact/subagent）路由。
// 支持环境变量覆盖 apiKey / baseUrl。

import type { ProviderProfile, ModelRole } from "./types.js";

export class ModelRegistry {
    private readonly profiles = new Map<string, ProviderProfile>();
    private readonly bindings = new Map<ModelRole, string>();
    private defaultId: string;

    constructor(
        models: Record<string, ProviderProfile>,
        bindings: Partial<Record<ModelRole, string>> = {},
        defaultId = "default",
    ) {
        this.defaultId = defaultId;

        for (const [id, profile] of Object.entries(models)) {
            this.profiles.set(id, this.resolveEnvOverrides(id, profile));
        }

        for (const [role, id] of Object.entries(bindings)) {
            if (id) this.bindings.set(role as ModelRole, id);
        }
    }

    private resolveEnvOverrides(id: string, profile: ProviderProfile): ProviderProfile {
        const envKey = `MODEL_${id.toUpperCase()}_API_KEY`;
        const envUrl = `MODEL_${id.toUpperCase()}_BASE_URL`;
        return {
            ...profile,
            id,
            apiKey: profile.apiKey || process.env[envKey] || process.env.API_KEY || process.env.OPENAI_API_KEY,
            baseUrl: profile.baseUrl || process.env[envUrl],
        };
    }

    get(id?: string): ProviderProfile {
        const target = id ?? this.defaultId;
        const profile = this.profiles.get(target);
        if (!profile) throw new Error(`Model profile "${target}" not found. Available: ${this.listIds().join(", ")}`);
        return profile;
    }

    getForRole(role: ModelRole): ProviderProfile {
        const id = this.bindings.get(role) ?? this.defaultId;
        return this.get(id);
    }

    getDefault(): ProviderProfile {
        return this.get(this.defaultId);
    }

    has(id: string): boolean {
        return this.profiles.has(id);
    }

    listIds(): string[] {
        return Array.from(this.profiles.keys());
    }

    listProfiles(): ProviderProfile[] {
        return Array.from(this.profiles.values());
    }

    /**
     * 上下文溢出时尝试找到更大的模型
     */
    findLargerModel(currentId: string): ProviderProfile | null {
        const current = this.get(currentId);
        let best: ProviderProfile | null = null;

        for (const profile of this.profiles.values()) {
            if (profile.id === currentId) continue;
            if (profile.contextWindow <= current.contextWindow) continue;
            if (profile.capabilities && !profile.capabilities.functionCalling) continue;
            if (!best || profile.contextWindow < best.contextWindow) {
                best = profile;
            }
        }

        return best;
    }

    setBinding(role: ModelRole, id: string): void {
        if (!this.profiles.has(id)) {
            throw new Error(`Cannot bind role "${role}" to unknown profile "${id}"`);
        }
        this.bindings.set(role, id);
    }

    getBindings(): Record<string, string> {
        const result: Record<string, string> = {};
        for (const [role, id] of this.bindings) {
            result[role] = id;
        }
        return result;
    }
}
