// ── FileFreshnessService ──────────────────────────────────────────
// 追踪 Agent 交互过的文件的"热度"，用于 auto_compact 后回温决策。
// 热度评分策略：Agent 编辑 > Agent 读取 > 时间衰减

export interface FileRecord {
    path: string;
    lastRead: number;
    lastWrite: number;
    readCount: number;
    writeCount: number;
}

export class FileFreshnessService {
    private readonly records = new Map<string, FileRecord>();

    trackRead(filePath: string): void {
        const existing = this.records.get(filePath);
        if (existing) {
            existing.lastRead = Date.now();
            existing.readCount++;
        } else {
            this.records.set(filePath, {
                path: filePath,
                lastRead: Date.now(),
                lastWrite: 0,
                readCount: 1,
                writeCount: 0,
            });
        }
    }

    trackWrite(filePath: string): void {
        const existing = this.records.get(filePath);
        if (existing) {
            existing.lastWrite = Date.now();
            existing.writeCount++;
        } else {
            this.records.set(filePath, {
                path: filePath,
                lastRead: 0,
                lastWrite: Date.now(),
                readCount: 0,
                writeCount: 1,
            });
        }
    }

    /**
     * 按热度降序排列所有文件。
     *
     * 评分规则：
     * - 写过的文件 +100
     * - 最近 1 分钟读过 +50
     * - 时间衰减（读/写中更近的那个）
     */
    rankByFreshness(): FileRecord[] {
        const now = Date.now();
        return [...this.records.values()].sort((a, b) => {
            return this.scoreFile(b, now) - this.scoreFile(a, now);
        });
    }

    /**
     * 获取 top-N 最热门的文件路径（供回温使用）。
     */
    getHottestPaths(limit: number): string[] {
        return this.rankByFreshness().slice(0, limit).map(r => r.path);
    }

    get size(): number {
        return this.records.size;
    }

    private scoreFile(record: FileRecord, now: number): number {
        let score = 0;

        if (record.writeCount > 0) score += 100;

        const lastTouch = Math.max(record.lastRead, record.lastWrite);
        const ageMinutes = (now - lastTouch) / 60_000;

        if (ageMinutes < 1) score += 50;
        score += Math.max(0, 30 - ageMinutes);

        score += Math.min(record.readCount * 5, 25);
        score += Math.min(record.writeCount * 10, 30);

        return score;
    }

    clear(): void {
        this.records.clear();
    }
}
