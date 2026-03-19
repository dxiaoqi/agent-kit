import { z } from "zod";

export enum ApprovalPolicy {
  AUTO    = "auto",     // approve all operations silently
  CONFIRM = "confirm",  // prompt user before mutating operations
  DENY    = "deny",     // reject all mutating operations
}

// ── Model Profile ─────────────────────────────────────────────────
const ModelProfileSchema = z.object({
  name:          z.string(),
  apiKey:        z.string().optional(),
  baseUrl:       z.string().optional(),
  temperature:   z.number().min(0).max(2).default(0.7),
  contextWindow: z.number().default(128_000),
  maxTokens:     z.number().optional(),
  provider:      z.string().optional(),
});

// ── Model Bindings (role → profileId) ────────────────────────────
const ModelBindingsSchema = z
  .object({
    compaction: z.string().optional(),
    subagent:   z.string().optional(),
  })
  .catchall(z.string().optional() as z.ZodType<string | undefined>);

// ── Sub-agent Config ──────────────────────────────────────────────
const SubagentConfigSchema = z.object({
  name:         z.string(),
  description:  z.string(),
  goalPrompt:   z.string(),
  model:        z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  maxTurns:     z.number().default(20),
});

// ── Permission Rule (from config.toml [[permission_rules]]) ──────
const PermissionRuleConfigSchema = z.object({
  action:        z.enum(["allow", "deny"]),
  toolName:      z.string().default("*"),
  pathPattern:   z.string().optional(),
  commandPrefix: z.string().optional(),
});

export type PermissionRuleConfig = z.infer<typeof PermissionRuleConfigSchema>;

// ── Safety Rule (from config.toml [[safety_rules]]) ──────────────
const SafetyRuleConfigSchema = z.object({
  type:     z.enum(["dangerous_command", "sensitive_path", "safe_command"]),
  pattern:  z.string(),
  category: z.string(),
  risk:     z.enum(["moderate", "high"]).optional(),
});

export type SafetyRuleConfig = z.infer<typeof SafetyRuleConfigSchema>;

// ── Sandbox Config (aligned with Claude Code) ──────────────────
const SandboxFilesystemSchema = z.object({
  allowWrite: z.array(z.string()).default([]),
  denyWrite:  z.array(z.string()).default(["~/.ssh", "~/.gnupg"]),
  denyRead:   z.array(z.string()).default(["~/.aws/credentials", "~/.config/gcloud/credentials.db", "~/.azure"]),
});

const SandboxNetworkSchema = z.object({
  allowedDomains:          z.array(z.string()).default([
    "registry.npmjs.org", "pypi.org", "files.pythonhosted.org", "crates.io",
    "github.com", "raw.githubusercontent.com", "api.github.com",
  ]),
  allowManagedDomainsOnly: z.boolean().default(false),
  httpProxyPort:           z.number().default(0),
  socksProxyPort:          z.number().default(0),
});

const DockerSandboxSchema = z.object({
  image:       z.string().default("node:20-slim"),
  pullOnStart: z.boolean().default(false),
  memoryLimit: z.string().default("512m"),
  cpuLimit:    z.number().default(1),
  extraArgs:   z.array(z.string()).default([]),
});

const SandboxConfigSchema = z.object({
  enabled:                 z.boolean().default(true),
  permissions:             z.enum(["auto-allow", "default"]).default("auto-allow"),
  preferStrategy:          z.enum(["native", "docker"]).default("native"),
  allowUnsandboxedCommands: z.boolean().default(true),
  excludedCommands:        z.array(z.string()).default(["docker", "podman", "nerdctl"]),
  filesystem:              SandboxFilesystemSchema.default({}),
  network:                 SandboxNetworkSchema.default({}),
  timeout:                 z.number().default(30_000),
  maxOutput:               z.number().default(1024 * 1024),
  docker:                  DockerSandboxSchema.default({}),
});

export type SandboxConfigFromToml = z.infer<typeof SandboxConfigSchema>;

// ── Root Config ───────────────────────────────────────────────────
export const ConfigSchema = z.object({
  defaultModel:          z.string().default("default"),
  models:                z.record(ModelProfileSchema).default({}),
  modelBindings:         ModelBindingsSchema.default({}),
  approval:              z.nativeEnum(ApprovalPolicy).default(ApprovalPolicy.CONFIRM),
  maxTurns:              z.number().default(0),      // 0 = unlimited
  cwd:                   z.string().default(process.cwd()),
  userInstructions:      z.string().optional(),
  developerInstructions: z.string().optional(),
  debug:                 z.boolean().default(false),
  subagents:             z.array(SubagentConfigSchema).optional(),
  permissionRules:       z.array(PermissionRuleConfigSchema).default([]),
  safetyRules:           z.array(SafetyRuleConfigSchema).default([]),
  /** 启动时激活的工作流（null = 无，使用全部模块） */
  workflow:              z.string().optional(),
  /** Skill 目录列表 */
  skillDirs:             z.array(z.string()).default([".agent/skills"]),
  /** 沙箱配置 */
  sandbox:               SandboxConfigSchema.default({}),
});

export type ModelProfile  = z.infer<typeof ModelProfileSchema>;
export type ModelBindings = z.infer<typeof ModelBindingsSchema>;
export type SubagentConfig = z.infer<typeof SubagentConfigSchema>;
export type Config         = z.infer<typeof ConfigSchema>;

export function createConfig(data: Record<string, any>): Config {
  const parsed = ConfigSchema.parse(data);

  // If no profiles defined, build a "default" profile from env vars
  if (Object.keys(parsed.models).length === 0) {
    const apiKey  = process.env.API_KEY || process.env.OPENAI_API_KEY;
    const baseUrl = process.env.BASE_URL || process.env.OPENAI_API_BASE_URL;
    if (apiKey || baseUrl) {
      parsed.models["default"] = {
        name:          "gpt-4o-mini",
        apiKey,
        baseUrl,
        temperature:   0.7,
        contextWindow: 128_000,
      };
    }
  }

  return parsed;
}

export function validateConfig(config: Config): string[] {
  const errors: string[] = [];

  const profiles = Object.values(config.models);
  if (profiles.length === 0) {
    errors.push(
      "No model profiles found. Add [models.default] to .agent/config.toml or set API_KEY env var."
    );
  }

  for (const [id, profile] of Object.entries(config.models)) {
    const resolvedKey =
      profile.apiKey ||
      process.env[`MODEL_${id.toUpperCase()}_API_KEY`] ||
      process.env.API_KEY ||
      process.env.OPENAI_API_KEY;

    if (!resolvedKey && !profile.baseUrl?.includes("localhost") && !profile.baseUrl?.includes("127.0.0.1")) {
      errors.push(
        `Model profile "${id}" has no apiKey. Set it in config or MODEL_${id.toUpperCase()}_API_KEY env var.`
      );
    }
  }

  return errors;
}
