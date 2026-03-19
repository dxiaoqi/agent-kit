// ── SkillLoader ──────────────────────────────────────────────────
// 两层 skill 注入（遵循 Claude Code 模式）：
//
//   Layer 1（系统提示）：仅元数据（name + description），~100 tokens/skill
//   Layer 2（按需加载）：通过 load_skill 工具注入完整 body 到 tool_result
//
// 目录结构：
//   .agent/skills/
//     pdf/
//       SKILL.md        ← YAML frontmatter + body
//     code-review/
//       SKILL.md

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, basename, dirname } from "node:path";

// ── Skill 定义 ──────────────────────────────────────────────────

export interface SkillMeta {
    name: string;
    description: string;
    tags?: string;
}

export interface Skill {
    meta: SkillMeta;
    body: string;
    path: string;
}

// ── SkillLoader ─────────────────────────────────────────────────

export class SkillLoader {
    private readonly skills = new Map<string, Skill>();

    constructor(private readonly dirs: string[]) {
        this.scanAll();
    }

    private scanAll(): void {
        for (const dir of this.dirs) {
            if (!existsSync(dir)) continue;
            this.scanDir(dir);
        }
    }

    private scanDir(dir: string): void {
        let entries: string[];
        try {
            entries = readdirSync(dir);
        } catch {
            return;
        }

        for (const entry of entries) {
            const fullPath = join(dir, entry);

            // 直接是 SKILL.md
            if (entry === "SKILL.md") {
                this.loadSkillFile(fullPath);
                continue;
            }

            // 子目录/SKILL.md
            try {
                if (statSync(fullPath).isDirectory()) {
                    const skillPath = join(fullPath, "SKILL.md");
                    if (existsSync(skillPath)) {
                        this.loadSkillFile(skillPath);
                    }
                }
            } catch {
                continue;
            }
        }
    }

    private loadSkillFile(filePath: string): void {
        try {
            const text = readFileSync(filePath, "utf-8");
            const { meta, body } = parseFrontmatter(text);

            const name = meta.name || basename(dirname(filePath));
            const skill: Skill = {
                meta: {
                    name,
                    description: meta.description || "No description",
                    tags: meta.tags,
                },
                body,
                path: filePath,
            };

            this.skills.set(name, skill);
        } catch {
            // skip malformed files
        }
    }

    // ── Layer 1：系统提示中的 skill 目录 ────────────────────────

    getDescriptions(): string {
        if (this.skills.size === 0) return "";

        const lines: string[] = [];
        for (const [name, skill] of this.skills) {
            let line = `  - ${name}: ${skill.meta.description}`;
            if (skill.meta.tags) line += ` [${skill.meta.tags}]`;
            lines.push(line);
        }

        return `\nAvailable skills (use load_skill tool to activate):\n${lines.join("\n")}`;
    }

    // ── Layer 2：按名称加载完整 body ────────────────────────────

    getContent(name: string): string | null {
        const skill = this.skills.get(name);
        return skill?.body ?? null;
    }

    // ── 查询 ────────────────────────────────────────────────────

    has(name: string): boolean {
        return this.skills.has(name);
    }

    list(): string[] {
        return Array.from(this.skills.keys());
    }

    getAll(): Map<string, Skill> {
        return this.skills;
    }

    get size(): number {
        return this.skills.size;
    }
}

// ── Frontmatter 解析 ────────────────────────────────────────────

function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
    const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) {
        return { meta: {}, body: text.trim() };
    }

    const meta: Record<string, string> = {};
    for (const line of match[1].trim().split("\n")) {
        const colonIdx = line.indexOf(":");
        if (colonIdx > 0) {
            const key = line.slice(0, colonIdx).trim();
            const val = line.slice(colonIdx + 1).trim();
            meta[key] = val;
        }
    }

    return { meta, body: match[2].trim() };
}
