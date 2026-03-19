// ── MessageBus：节点间通信 ────────────────────────────────────────
// 简单的发布/订阅 + 存储模型。
// DAGScheduler 在节点完成后 publish，下游节点启动前 collect。

import type { BusMessage } from "./types.js";

type MessageHandler = (msg: BusMessage) => void;

export class MessageBus {
    private readonly messages: BusMessage[] = [];
    private readonly handlers = new Map<string, MessageHandler[]>();

    publish(msg: BusMessage): void {
        this.messages.push(msg);
        const handlers = this.handlers.get(msg.to);
        if (handlers) {
            for (const handler of handlers) handler(msg);
        }
    }

    subscribe(nodeId: string, handler: MessageHandler): () => void {
        const list = this.handlers.get(nodeId) ?? [];
        list.push(handler);
        this.handlers.set(nodeId, list);
        return () => {
            const idx = list.indexOf(handler);
            if (idx >= 0) list.splice(idx, 1);
        };
    }

    /** 收集发给指定节点的所有数据消息 */
    collectInputs(nodeId: string): BusMessage[] {
        return this.messages.filter(m => m.to === nodeId && m.type === "data");
    }

    /** 收集指定节点发出的所有数据消息 */
    collectOutputs(nodeId: string): BusMessage[] {
        return this.messages.filter(m => m.from === nodeId && m.type === "data");
    }

    getAll(): readonly BusMessage[] {
        return this.messages;
    }

    clear(): void {
        this.messages.length = 0;
        this.handlers.clear();
    }
}
