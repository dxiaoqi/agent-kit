// ── TranscriptLogger ──────────────────────────────────────────────
// 将对话消息以 JSONL 格式追加写入磁盘。
// 两个用途：
//   1. auto_compact 前保存完整对话（信息不丢失）
//   2. 会话历史审计 / 调试

import * as fs from "node:fs";
import * as path from "node:path";
import type { Message } from "./message.js";

export interface TranscriptEntry {
    timestamp: number;
    type: "message" | "compact" | "session_start" | "session_end";
    data: unknown;
}

export class TranscriptLogger {
    private readonly filePath: string;
    private writeStream: fs.WriteStream | null = null;

    constructor(sessionDir: string, sessionId?: string) {
        const id = sessionId ?? `session-${Date.now()}`;
        const dir = path.resolve(sessionDir);
        fs.mkdirSync(dir, { recursive: true });
        this.filePath = path.join(dir, `${id}.jsonl`);
    }

    private getStream(): fs.WriteStream {
        if (!this.writeStream) {
            this.writeStream = fs.createWriteStream(this.filePath, { flags: "a" });
        }
        return this.writeStream;
    }

    logSessionStart(metadata: Record<string, unknown> = {}): void {
        this.writeEntry({
            timestamp: Date.now(),
            type: "session_start",
            data: { ...metadata, startedAt: new Date().toISOString() },
        });
    }

    logMessage(message: Message): void {
        this.writeEntry({
            timestamp: Date.now(),
            type: "message",
            data: message,
        });
    }

    logMessages(messages: readonly Message[]): void {
        for (const msg of messages) {
            this.logMessage(msg);
        }
    }

    /**
     * 记录一次 compact 事件（压缩前后的 token 数、生成的摘要等）
     */
    logCompactEvent(data: {
        beforeTokens: number;
        afterTokens: number;
        summary: string;
        messageCountBefore: number;
        messageCountAfter: number;
    }): void {
        this.writeEntry({
            timestamp: Date.now(),
            type: "compact",
            data,
        });
    }

    logSessionEnd(metadata: Record<string, unknown> = {}): void {
        this.writeEntry({
            timestamp: Date.now(),
            type: "session_end",
            data: { ...metadata, endedAt: new Date().toISOString() },
        });
    }

    get path(): string {
        return this.filePath;
    }

    close(): void {
        if (this.writeStream) {
            this.writeStream.end();
            this.writeStream = null;
        }
    }

    private writeEntry(entry: TranscriptEntry): void {
        const line = JSON.stringify(entry) + "\n";
        this.getStream().write(line);
    }
}

// ── 读取工具（供调试 / 恢复使用）───────────────────────────────

export function readTranscript(filePath: string): TranscriptEntry[] {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, "utf-8");
    return content
        .split("\n")
        .filter(line => line.trim())
        .map(line => JSON.parse(line) as TranscriptEntry);
}
