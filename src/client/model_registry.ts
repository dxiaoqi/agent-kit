import { Config, ModelProfile } from "../config/config.js";

export type ModelRole = "main" | "compaction" | "subagent" | string;

/**
 * Manages model profiles and routes by role.
 *
 * Priority for apiKey resolution per profile:
 *   config.models.<id>.apiKey
 *   → MODEL_<ID>_API_KEY env var
 *   → API_KEY / OPENAI_API_KEY env var (fallback)
 */
export class ModelRegistry {
  private readonly profiles: Map<string, ModelProfile> = new Map();
  private readonly bindings: Record<string, string>;
  readonly defaultModelId: string;

  constructor(config: Config) {
    this.defaultModelId = config.defaultModel;
    this.bindings       = config.modelBindings as Record<string, string>;

    for (const [id, profile] of Object.entries(config.models)) {
      this.profiles.set(id, this.resolveProfile(id, profile));
    }
  }

  private resolveProfile(_id: string, profile: ModelProfile): ModelProfile {
    // env var 解析已统一在 config/loader.ts 中完成，此处直接透传
    return { ...profile };
  }

  /** Get a profile by id. Throws if not found. */
  get(modelId?: string): ModelProfile {
    const id = modelId || this.defaultModelId;
    const profile = this.profiles.get(id);
    if (!profile) {
      throw new Error(
        `Model profile "${id}" not found. Available: ${this.list().join(", ")}`
      );
    }
    return profile;
  }

  /**
   * Get the profile bound to a functional role.
   * Falls back to defaultModel if no binding is configured.
   */
  getForRole(role: ModelRole): ModelProfile {
    const boundId = this.bindings[role];
    return this.get(boundId || undefined);
  }

  list(): string[] {
    return Array.from(this.profiles.keys());
  }

  has(id: string): boolean {
    return this.profiles.has(id);
  }
}
