// ── 规则存储 ─────────────────────────────────────────────────────
// 两级作用域：
//   session → 内存（会话结束即失效，用户审批时产生）
//   config  → 来自 config.toml [[permission_rules]]（只读，启动时注入）
//
// 不做独立文件持久化；需要永久生效的规则由用户手动写入 config.toml。

import type { PermissionRule, RuleScope, RuleAction } from "./types.js";
import type { PermissionRuleConfig } from "../config/config.js";
import { matchGlob } from "./paths.js";

export class RuleStore {
    private sessionRules: PermissionRule[] = [];
    private configRules: PermissionRule[] = [];
    private nextId = 1;

    // ── 从 config.toml 加载静态规则 ─────────────────────────────

    loadFromConfig(rules: PermissionRuleConfig[]): void {
        this.configRules = rules.map((r, i) => ({
            id: `cfg-${i + 1}`,
            action: r.action,
            toolName: r.toolName,
            pathPattern: r.pathPattern,
            commandPrefix: r.commandPrefix,
            scope: "config" as RuleScope,
            createdAt: 0,
        }));
    }

    // ── 添加会话规则（用户审批时产生）────────────────────────────

    addRule(
        action: RuleAction,
        toolName: string,
        _scope: RuleScope,
        options?: { pathPattern?: string; commandPrefix?: string },
    ): PermissionRule {
        const rule: PermissionRule = {
            id: `rule-${this.nextId++}`,
            action,
            toolName,
            pathPattern: options?.pathPattern,
            commandPrefix: options?.commandPrefix,
            scope: "session",
            createdAt: Date.now(),
        };

        this.sessionRules.push(rule);
        return rule;
    }

    // ── 查询匹配规则 ────────────────────────────────────────────
    // 优先级：deny > allow，session > config

    findMatchingRule(
        toolName: string,
        filePath?: string,
        command?: string,
        cwd?: string,
    ): PermissionRule | null {
        const allRules = [...this.sessionRules, ...this.configRules];

        const denyRule = allRules.find(r =>
            r.action === "deny" && this.ruleMatches(r, toolName, filePath, command, cwd),
        );
        if (denyRule) return denyRule;

        const allowRule = allRules.find(r =>
            r.action === "allow" && this.ruleMatches(r, toolName, filePath, command, cwd),
        );
        return allowRule ?? null;
    }

    private ruleMatches(
        rule: PermissionRule,
        toolName: string,
        filePath?: string,
        command?: string,
        cwd?: string,
    ): boolean {
        if (rule.toolName !== "*" && rule.toolName !== toolName) return false;

        if (rule.pathPattern && filePath && cwd) {
            if (!matchGlob(rule.pathPattern, filePath, cwd)) return false;
        } else if (rule.pathPattern && !filePath) {
            return false;
        }

        if (rule.commandPrefix && command) {
            const prefix = rule.commandPrefix.replace(/\*$/, "");
            if (!command.startsWith(prefix)) return false;
        } else if (rule.commandPrefix && !command) {
            return false;
        }

        return true;
    }

    // ── 列出 / 清除 ─────────────────────────────────────────────

    listRules(scope?: RuleScope): readonly PermissionRule[] {
        if (scope === "session") return this.sessionRules;
        if (scope === "config") return this.configRules;
        return [...this.sessionRules, ...this.configRules];
    }

    clearSession(): void {
        this.sessionRules = [];
    }

    removeRule(id: string): boolean {
        const idx = this.sessionRules.findIndex(r => r.id === id);
        if (idx >= 0) {
            this.sessionRules.splice(idx, 1);
            return true;
        }
        return false;
    }
}
