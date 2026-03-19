// ── Agent 驱动器 ─────────────────────────────────────────────────
// 通过子进程 stdin/stdout 驱动任意 CLI Agent

import { spawn, type ChildProcess } from "node:child_process";
import type { AgentDriver } from "./protocol.js";

// ── 通用 Stdio 驱动器 ──────────────────────────────────────────

/**
 * 通过 stdin/stdout 驱动任意命令行 Agent。
 *
 * 工作原理：
 *   1. 启动子进程（如 `npx tsx src/main.ts --non-interactive`）
 *   2. 通过 stdin 写入用户消息
 *   3. 通过 stdout 读取 Agent 响应
 *   4. 使用分隔符协议区分消息边界
 *
 * 适用于任何支持 pipe 模式的 Agent CLI。
 */
export class StdioDriver implements AgentDriver {
    name: string;
    private proc: ChildProcess | null = null;
    private buffer = "";
    private responseResolve: ((value: string) => void) | null = null;

    constructor(
        private readonly config: {
            name: string;
            command: string;
            args: string[];
            cwd?: string;
            env?: Record<string, string>;
            /** 等待响应的超时时间（ms），默认 60s */
            timeout?: number;
            /**
             * 判断一段 stdout 输出是否是"完整响应"的函数。
             * 默认策略：1 秒内没有新输出就认为响应结束。
             */
            isResponseComplete?: (buffer: string) => boolean;
        },
    ) {
        this.name = config.name;
    }

    async start(): Promise<void> {
        this.proc = spawn(this.config.command, this.config.args, {
            cwd: this.config.cwd,
            env: { ...process.env, ...this.config.env },
            stdio: ["pipe", "pipe", "pipe"],
        });

        this.proc.stdout?.setEncoding("utf-8");
        this.proc.stderr?.setEncoding("utf-8");

        this.proc.stdout?.on("data", (chunk: string) => {
            this.buffer += chunk;
        });

        this.proc.stderr?.on("data", (chunk: string) => {
            // stderr 通常是 spinner/进度信息，忽略
        });

        this.proc.on("error", (err) => {
            if (this.responseResolve) {
                this.responseResolve(`[DRIVER ERROR] ${err.message}`);
                this.responseResolve = null;
            }
        });

        // 等待进程启动稳定
        await sleep(1000);
    }

    async send(message: string): Promise<string> {
        if (!this.proc?.stdin) throw new Error("Agent not started");

        this.buffer = "";
        this.proc.stdin.write(message + "\n");

        return this.waitForResponse();
    }

    async sendFiller(topic: string, turns: number): Promise<void> {
        for (let i = 0; i < turns; i++) {
            const fillerMsg = generateFillerMessage(topic, i);
            await this.send(fillerMsg);
            // 不需要精确记录 filler 响应
        }
    }

    async close(): Promise<void> {
        if (this.proc) {
            this.proc.stdin?.end();
            this.proc.kill("SIGTERM");
            await sleep(500);
            if (!this.proc.killed) this.proc.kill("SIGKILL");
            this.proc = null;
        }
    }

    private waitForResponse(): Promise<string> {
        const timeout = this.config.timeout ?? 60_000;

        return new Promise((resolve) => {
            let lastLen = 0;
            let stableCount = 0;

            const timer = setInterval(() => {
                if (this.buffer.length === lastLen) {
                    stableCount++;
                } else {
                    stableCount = 0;
                    lastLen = this.buffer.length;
                }

                // 自定义完成检测
                if (this.config.isResponseComplete?.(this.buffer)) {
                    clearInterval(timer);
                    clearTimeout(deadline);
                    resolve(this.buffer.trim());
                    return;
                }

                // 默认：连续 1 秒无新输出视为响应完成
                if (stableCount >= 4 && this.buffer.length > 0) {
                    clearInterval(timer);
                    clearTimeout(deadline);
                    resolve(this.buffer.trim());
                }
            }, 250);

            const deadline = setTimeout(() => {
                clearInterval(timer);
                resolve(this.buffer.trim() || "[TIMEOUT]");
            }, timeout);
        });
    }
}

// ── Mock 驱动器（本地测试用）──────────────────────────────────────

/**
 * 模拟 Agent 的驱动器，用于验证 benchmark 框架本身的正确性。
 * 提供两种模式：
 *   - perfect:  完美记忆，总是正确回答检查点
 *   - amnesia:  健忘模式，压缩后丢失所有细节
 */
export class MockDriver implements AgentDriver {
    name: string;
    private memory: string[] = [];
    private fillerCount = 0;

    constructor(private readonly mode: "perfect" | "amnesia" | "partial") {
        this.name = `mock-${mode}`;
    }

    async start(): Promise<void> {
        this.memory = [];
        this.fillerCount = 0;
    }

    async send(message: string): Promise<string> {
        this.memory.push(message);

        if (this.mode === "perfect") {
            return this.perfectResponse(message);
        } else if (this.mode === "amnesia") {
            return this.amnesiaResponse(message);
        } else {
            return this.partialResponse(message);
        }
    }

    async sendFiller(_topic: string, turns: number): Promise<void> {
        this.fillerCount += turns;

        // amnesia 模式在填充后清空记忆
        if (this.mode === "amnesia") {
            this.memory = [];
        }
        // partial 模式保留 50% 的记忆
        if (this.mode === "partial") {
            this.memory = this.memory.slice(Math.floor(this.memory.length / 2));
        }
    }

    async close(): Promise<void> {
        this.memory = [];
    }

    private perfectResponse(message: string): string {
        const allContext = this.memory.join("\n");

        // 检测是否是探测问题并生成"完美"回答
        if (message.includes("maxTurns") && allContext.includes("50")) {
            return "maxTurns 设置的是 50，配置在 config.toml 文件中。";
        }
        if (message.includes("TINYINT")) {
            return "MySQL 的 TINYINT(1) 应该映射为 PostgreSQL 的 BOOLEAN，不应该用 SMALLINT。";
        }
        if (message.includes("TypeError") && allContext.includes("agent.ts")) {
            return "TypeError 错误发生在 src/kernel/agent.ts 的第 142 行，原因是 ContextManager 没有在构造函数中正确初始化 prepareForLLMCall。";
        }
        if (message.includes("架构决策") || message.includes("三条")) {
            return "三条架构决策：1) 插件系统使用事件驱动模式 2) 状态管理使用不可变数据结构 3) 所有 IO 操作通过 Provider 抽象层。";
        }
        if (message.includes("上下文管理器") && message.includes("端口")) {
            return "上下文管理器路径是 src/context/manager.ts，端口号是 3847。";
        }
        if (message.includes("P99") && message.includes("QPS")) {
            return "P99 延迟是 187ms，QPS 峰值是 12500。";
        }
        if (message.includes("JWT") && message.includes("限流")) {
            return "JWT token 过期时间是 24 小时，限流阈值每分钟 100 次。如果 token 过期了还在疯狂请求，应该先返回 429 限流再返回 401 认证过期。";
        }
        return `收到了你的消息，共 ${message.length} 字。`;
    }

    private amnesiaResponse(message: string): string {
        if (this.fillerCount > 0) {
            // 填充后，假装不记得任何早期信息
            if (message.includes("之前") || message.includes("我们")) {
                return "抱歉，我不记得我们之前讨论过什么。你能重新说一下吗？";
            }
        }
        return `好的，收到你的信息。`;
    }

    private partialResponse(message: string): string {
        const allContext = this.memory.join("\n");

        // partial 模式：保留部分信息但丢失精确数值
        if (message.includes("maxTurns") && allContext.includes("config")) {
            return "maxTurns 好像在 config.toml 里设置过，但我不太确定具体值。";
        }
        if (message.includes("TypeError")) {
            return "之前确实有一个 TypeError 错误在 agent.ts 里，跟 ContextManager 有关。";
        }
        if (message.includes("架构决策")) {
            return "我们确定了事件驱动模式的插件系统，还有不可变数据结构。第三条我记不太清了。";
        }
        if (message.includes("P99")) {
            return "P99 延迟大概是 180 多 ms，QPS 我记不太清楚了。";
        }
        return `好的，继续吧。`;
    }
}

// ── 辅助 ─────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const FILLER_TEMPLATES = [
    (topic: string, i: number) => `关于${topic}，第 ${i} 个问题：有哪些最佳实践？`,
    (topic: string, i: number) => `${topic}方面，你觉得 ${i % 3 === 0 ? "性能" : i % 3 === 1 ? "可维护性" : "安全性"} 怎么优化？`,
    (topic: string, i: number) => `继续聊${topic}。步骤 ${i}：具体实现方案是什么？`,
    (topic: string, i: number) => `关于${topic}的第 ${i} 个细节，有什么需要注意的？`,
    (topic: string, i: number) => `${topic}中常见的第 ${i} 类问题怎么解决？`,
];

function generateFillerMessage(topic: string, index: number): string {
    const template = FILLER_TEMPLATES[index % FILLER_TEMPLATES.length];
    return template(topic, index);
}
