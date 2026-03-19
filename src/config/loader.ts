import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import { parse } from "toml";
import * as os from "os";
import { createConfig, Config } from "./config.js";
import { ConfigError } from "../utils/errors.js";

const CONFIG_FILE  = "config.toml";
const AGENT_MD_FILE = "AGENT.MD";

// ── Platform paths ────────────────────────────────────────────────

export function getConfigDir(): string {
  const home = os.homedir();
  if (process.platform === "win32")  return join(home, "AppData", "Roaming", "agent-kit");
  if (process.platform === "darwin") return join(home, "Library", "Application Support", "agent-kit");
  return join(home, ".config", "agent-kit");
}

// ── TOML helpers ──────────────────────────────────────────────────

function parseTomlFile(path: string): Record<string, any> {
  try {
    return parse(readFileSync(path, "utf-8")) as Record<string, any>;
  } catch (err: any) {
    throw new ConfigError(`Invalid TOML in ${path}: ${err.message}`, { configFile: path });
  }
}

function deepMerge(
  base: Record<string, any>,
  override: Record<string, any>
): Record<string, any> {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      key in result &&
      typeof result[key] === "object" && !Array.isArray(result[key]) &&
      typeof value        === "object" && !Array.isArray(value)
    ) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// Convert snake_case keys to camelCase recursively (including array elements)
function normKeys(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    const camel = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    out[camel] = normValue(v);
  }
  return out;
}

function normValue(v: any): any {
  if (Array.isArray(v)) {
    return v.map(normValue);
  }
  if (v && typeof v === "object") {
    return normKeys(v as Record<string, any>);
  }
  return v;
}

// ── Main loader ───────────────────────────────────────────────────

export function loadConfig(cwd?: string): Config {
  cwd = resolve(cwd || process.cwd());

  let raw: Record<string, any> = {};

  // 1. System-wide config
  const systemPath = join(getConfigDir(), CONFIG_FILE);
  if (existsSync(systemPath)) {
    try {
      raw = deepMerge(raw, normKeys(parseTomlFile(systemPath)));
    } catch (err: any) {
      console.warn(`[agent-kit] Skipping invalid system config: ${err.message}`);
    }
  }

  // 2. Project config (.agent/config.toml)
  const projectPath = join(cwd, ".agent", CONFIG_FILE);
  if (existsSync(projectPath)) {
    try {
      raw = deepMerge(raw, normKeys(parseTomlFile(projectPath)));
    } catch (err: any) {
      console.warn(`[agent-kit] Skipping invalid project config: ${err.message}`);
    }
  }

  // 3. Inject AGENT.MD as developerInstructions
  if (!raw.developerInstructions) {
    const mdPath = join(cwd, AGENT_MD_FILE);
    if (existsSync(mdPath)) {
      raw.developerInstructions = readFileSync(mdPath, "utf-8");
    }
  }

  // 4. Resolve per-profile env vars into models (single source of truth)
  if (raw.models && typeof raw.models === "object") {
    for (const [id, profile] of Object.entries(raw.models as Record<string, any>)) {
      if (!profile.apiKey) {
        const envKey = `MODEL_${id.toUpperCase()}_API_KEY`;
        profile.apiKey = process.env[envKey] || process.env.API_KEY || process.env.OPENAI_API_KEY;
      }
      if (!profile.baseUrl) {
        const envUrl = `MODEL_${id.toUpperCase()}_BASE_URL`;
        profile.baseUrl = process.env[envUrl] || process.env.BASE_URL || process.env.OPENAI_API_BASE_URL;
      }
    }
  }

  raw.cwd = raw.cwd || cwd;

  try {
    return createConfig(raw);
  } catch (err: any) {
    throw new ConfigError(`Invalid configuration: ${err.message}`, { cause: err });
  }
}
