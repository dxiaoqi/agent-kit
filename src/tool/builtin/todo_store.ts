// ── TodoStore：会话级任务列表单例 ──────────────────────────────────
// 纯内存存储，会话结束即丢弃。
// Agent 通过 todo_write / todo_read 工具读写。

export interface TodoItem {
    id: string;
    content: string;
    status: "pending" | "in_progress" | "completed" | "cancelled";
}

export class TodoStore {
    static readonly instance = new TodoStore();

    private items: TodoItem[] = [];

    private constructor() {}

    replace(todos: TodoItem[]): void {
        this.items = todos.map(t => ({ ...t }));
    }

    merge(updates: Partial<TodoItem>[]): void {
        for (const update of updates) {
            if (!update.id) continue;
            const existing = this.items.find(i => i.id === update.id);
            if (existing) {
                if (update.content !== undefined) existing.content = update.content;
                if (update.status !== undefined) existing.status = update.status;
            } else {
                if (update.content && update.status) {
                    this.items.push({
                        id: update.id,
                        content: update.content,
                        status: update.status,
                    });
                }
            }
        }
    }

    getAll(): readonly TodoItem[] {
        return this.items;
    }

    getByStatus(status: TodoItem["status"]): readonly TodoItem[] {
        return this.items.filter(i => i.status === status);
    }

    getSummary(): string {
        if (this.items.length === 0) return "TODO list is empty.";

        const counts = { pending: 0, in_progress: 0, completed: 0, cancelled: 0 };
        for (const item of this.items) {
            counts[item.status]++;
        }

        const parts: string[] = [];
        if (counts.in_progress > 0) parts.push(`${counts.in_progress} in progress`);
        if (counts.pending > 0) parts.push(`${counts.pending} pending`);
        if (counts.completed > 0) parts.push(`${counts.completed} completed`);
        if (counts.cancelled > 0) parts.push(`${counts.cancelled} cancelled`);

        const lines = this.items.map(i => {
            const icon = i.status === "completed" ? "●"
                : i.status === "in_progress" ? "◐"
                : i.status === "cancelled" ? "✕"
                : "○";
            return `  ${icon} ${i.id}: ${i.content}`;
        });

        return `TODO: ${this.items.length} items (${parts.join(", ")})\n${lines.join("\n")}`;
    }

    clear(): void {
        this.items = [];
    }
}
