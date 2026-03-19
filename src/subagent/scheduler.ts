// ── DAGScheduler：拓扑排序 + 分层并发调度 ─────────────────────────
// 1. 拓扑排序检测环
// 2. 按层级分组（无依赖的同层节点并发执行）
// 3. 节点完成后通过 MessageBus 传递结果给下游
// 4. 失败节点的下游标记为 skipped

import type { DAGDef, DAGTrigger, DAGResult, NodeResult, BusMessage } from "./types.js";
import { MessageBus } from "./bus.js";
import { SubagentRunner, type RunnerDeps } from "./runner.js";

export class DAGScheduler {
    private graph: DAGDef | null = null;
    private readonly bus = new MessageBus();

    constructor(private readonly deps: RunnerDeps) {}

    loadGraph(graph: DAGDef): void {
        this.validateGraph(graph);
        this.graph = graph;
    }

    async execute(trigger: DAGTrigger): Promise<DAGResult> {
        if (!this.graph) throw new Error("No DAG graph loaded");

        const startTime = Date.now();
        this.bus.clear();

        const results = new Map<string, NodeResult>();
        const levels = this.topologicalLevels();

        for (const level of levels) {
            const executions = level.map(async (nodeId) => {
                if (this.shouldSkip(nodeId, results)) {
                    results.set(nodeId, {
                        nodeId,
                        status: "skipped",
                        error: "Upstream dependency failed",
                    });
                    return;
                }

                const node = this.graph!.nodes.find(n => n.id === nodeId)!;
                const upstreamMsgs = this.bus.collectInputs(nodeId);

                // 根节点注入触发器输入
                if (upstreamMsgs.length === 0 && this.isRoot(nodeId)) {
                    upstreamMsgs.push({
                        from: "_trigger",
                        to: nodeId,
                        type: "data",
                        payload: trigger.input,
                        timestamp: Date.now(),
                    });
                }

                const runner = new SubagentRunner(node, {
                    ...this.deps,
                    cwd: trigger.cwd,
                });

                const result = await runner.run(upstreamMsgs);
                results.set(nodeId, result);

                if (result.status === "completed" && result.output) {
                    const downstream = this.graph!.edges
                        .filter(e => e.from === nodeId)
                        .map(e => e.to);

                    for (const toId of downstream) {
                        const edge = this.graph!.edges.find(
                            e => e.from === nodeId && e.to === toId,
                        )!;

                        if (edge.condition && !this.evaluateCondition(edge.condition, result)) {
                            continue;
                        }

                        this.bus.publish({
                            from: nodeId,
                            to: toId,
                            type: "data",
                            payload: result.output,
                            timestamp: Date.now(),
                        });
                    }
                }
            });

            await Promise.allSettled(executions);
        }

        const allSuccess = Array.from(results.values()).every(
            r => r.status === "completed" || r.status === "skipped",
        );

        return {
            nodeResults: results,
            totalDurationMs: Date.now() - startTime,
            success: allSuccess,
        };
    }

    // ── 拓扑排序 + 分层 ─────────────────────────────────────────

    private topologicalLevels(): string[][] {
        if (!this.graph) return [];

        const inDegree = new Map<string, number>();
        const adj = new Map<string, string[]>();

        for (const node of this.graph.nodes) {
            inDegree.set(node.id, 0);
            adj.set(node.id, []);
        }

        for (const edge of this.graph.edges) {
            inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
            adj.get(edge.from)?.push(edge.to);
        }

        const levels: string[][] = [];
        let queue = Array.from(inDegree.entries())
            .filter(([, deg]) => deg === 0)
            .map(([id]) => id);

        while (queue.length > 0) {
            levels.push([...queue]);
            const nextQueue: string[] = [];

            for (const nodeId of queue) {
                for (const neighbor of adj.get(nodeId) ?? []) {
                    const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
                    inDegree.set(neighbor, newDeg);
                    if (newDeg === 0) nextQueue.push(neighbor);
                }
            }

            queue = nextQueue;
        }

        return levels;
    }

    private isRoot(nodeId: string): boolean {
        return !this.graph?.edges.some(e => e.to === nodeId);
    }

    private shouldSkip(nodeId: string, results: Map<string, NodeResult>): boolean {
        const upstreamIds = this.graph?.edges
            .filter(e => e.to === nodeId)
            .map(e => e.from) ?? [];

        return upstreamIds.some(id => {
            const r = results.get(id);
            return r && r.status === "failed";
        });
    }

    private evaluateCondition(condition: string, result: NodeResult): boolean {
        if (condition === "success") return result.status === "completed";
        if (condition === "failure") return result.status === "failed";
        if (condition.startsWith("contains:")) {
            const keyword = condition.slice("contains:".length).trim();
            return (result.output ?? "").includes(keyword);
        }
        return true;
    }

    // ── 验证 ────────────────────────────────────────────────────

    private validateGraph(graph: DAGDef): void {
        const nodeIds = new Set(graph.nodes.map(n => n.id));

        for (const edge of graph.edges) {
            if (!nodeIds.has(edge.from)) {
                throw new Error(`DAG edge references unknown node: ${edge.from}`);
            }
            if (!nodeIds.has(edge.to)) {
                throw new Error(`DAG edge references unknown node: ${edge.to}`);
            }
        }

        const levels = this.topologicalLevelsFromGraph(graph);
        const visited = levels.flat();
        if (visited.length !== graph.nodes.length) {
            throw new Error("DAG contains a cycle");
        }
    }

    private topologicalLevelsFromGraph(graph: DAGDef): string[][] {
        const inDegree = new Map<string, number>();
        const adj = new Map<string, string[]>();

        for (const node of graph.nodes) {
            inDegree.set(node.id, 0);
            adj.set(node.id, []);
        }
        for (const edge of graph.edges) {
            inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
            adj.get(edge.from)?.push(edge.to);
        }

        const levels: string[][] = [];
        let queue = Array.from(inDegree.entries())
            .filter(([, deg]) => deg === 0)
            .map(([id]) => id);

        while (queue.length > 0) {
            levels.push([...queue]);
            const next: string[] = [];
            for (const nodeId of queue) {
                for (const nb of adj.get(nodeId) ?? []) {
                    const d = (inDegree.get(nb) ?? 1) - 1;
                    inDegree.set(nb, d);
                    if (d === 0) next.push(nb);
                }
            }
            queue = next;
        }

        return levels;
    }

    // ── 查询 ────────────────────────────────────────────────────

    getGraph(): DAGDef | null {
        return this.graph;
    }

    getBus(): MessageBus {
        return this.bus;
    }
}
