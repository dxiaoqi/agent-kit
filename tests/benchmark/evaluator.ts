// ── 评估器 ─────────────────────────────────────────────────────
// 分析 Agent 响应，按检查标准评分

import type {
    BenchmarkScenario,
    ScenarioResult,
    CheckpointResult,
    CheckCriteria,
    AgentDriver,
    MemoryCategory,
    BenchmarkReport,
} from "./protocol.js";

// ── 核心：运行单个场景 ──────────────────────────────────────────

export async function runScenario(
    driver: AgentDriver,
    scenario: BenchmarkScenario,
): Promise<ScenarioResult> {
    const start = Date.now();
    const checkpoints: CheckpointResult[] = [];

    for (const step of scenario.steps) {
        switch (step.type) {
            case "user":
                await driver.send(step.content);
                break;

            case "filler":
                await driver.sendFiller(step.topic, step.turns);
                break;

            case "checkpoint": {
                const response = await driver.send(step.probe);
                const result = evaluateCheckpoint(step.probe, response, step.criteria);
                checkpoints.push(result);
                break;
            }
        }
    }

    const totalScore = checkpoints.length > 0
        ? checkpoints.reduce((sum, cp) => sum + cp.score, 0) / checkpoints.length
        : 0;

    return {
        scenarioId: scenario.id,
        category: scenario.category,
        description: scenario.description,
        checkpoints,
        totalScore,
        durationMs: Date.now() - start,
    };
}

// ── 检查点评估 ──────────────────────────────────────────────────

function evaluateCheckpoint(
    probe: string,
    response: string,
    criteria: CheckCriteria[],
): CheckpointResult {
    const responseLower = response.toLowerCase();
    const criteriaScores = criteria.map(criterion => {
        const { passed, detail } = evaluateCriterion(criterion, response, responseLower);
        return { criterion, passed, detail };
    });

    const totalWeight = criteria.reduce((s, c) => s + c.weight, 0);
    const weightedSum = criteriaScores.reduce(
        (s, cs) => s + (cs.passed ? cs.criterion.weight : 0),
        0,
    );
    const score = totalWeight > 0 ? weightedSum / totalWeight : 0;

    return { probe, response, criteriaScores, score };
}

function evaluateCriterion(
    criterion: CheckCriteria,
    response: string,
    responseLower: string,
): { passed: boolean; detail: string } {
    const valueLower = criterion.value.toLowerCase();

    switch (criterion.type) {
        case "keyword_present": {
            const found = responseLower.includes(valueLower);
            return {
                passed: found,
                detail: found
                    ? `✓ 包含关键词 "${criterion.value}"`
                    : `✗ 缺少关键词 "${criterion.value}"`,
            };
        }

        case "keyword_absent": {
            const found = responseLower.includes(valueLower);
            return {
                passed: !found,
                detail: !found
                    ? `✓ 未出现禁止词 "${criterion.value}"`
                    : `✗ 意外出现了 "${criterion.value}"`,
            };
        }

        case "semantic_match": {
            // 无 LLM 时使用启发式语义匹配：
            // 提取 value 中的核心词汇，检查响应中包含的比例
            const coreTerms = extractCoreTerms(criterion.value);
            const matchedTerms = coreTerms.filter(term =>
                responseLower.includes(term.toLowerCase()),
            );
            const ratio = coreTerms.length > 0 ? matchedTerms.length / coreTerms.length : 0;
            const passed = ratio >= 0.5; // ≥50% 核心词汇匹配视为语义相关

            return {
                passed,
                detail: passed
                    ? `✓ 语义匹配 ${matchedTerms.length}/${coreTerms.length} 核心词 (${(ratio * 100).toFixed(0)}%)`
                    : `✗ 语义偏离：仅匹配 ${matchedTerms.length}/${coreTerms.length} 核心词 (${(ratio * 100).toFixed(0)}%)`,
            };
        }

        case "consistency": {
            // consistency 需要上下文（先前检查点的响应），这里做简单相似度
            const overlap = computeWordOverlap(response, criterion.value);
            const passed = overlap >= 0.3;
            return {
                passed,
                detail: passed
                    ? `✓ 一致性 ${(overlap * 100).toFixed(0)}%`
                    : `✗ 不一致 ${(overlap * 100).toFixed(0)}%`,
            };
        }
    }
}

// ── 运行完整基准 ────────────────────────────────────────────────

export async function runBenchmark(
    driver: AgentDriver,
    scenarios: BenchmarkScenario[],
    options: { verbose?: boolean; onProgress?: (done: number, total: number) => void } = {},
): Promise<BenchmarkReport> {
    const results: ScenarioResult[] = [];

    await driver.start();

    for (let i = 0; i < scenarios.length; i++) {
        const scenario = scenarios[i];
        options.onProgress?.(i, scenarios.length);

        // 每个场景用独立会话（重启 driver）避免跨场景干扰
        if (i > 0) {
            await driver.close();
            await driver.start();
        }

        const result = await runScenario(driver, scenario);
        results.push(result);
    }

    await driver.close();

    // 按类别汇总
    const categoryScores = computeCategoryScores(results);

    const overallScore = results.length > 0
        ? results.reduce((s, r) => s + r.totalScore, 0) / results.length
        : 0;

    return {
        driverName: driver.name,
        timestamp: new Date().toISOString(),
        scenarios: results,
        categoryScores,
        overallScore,
    };
}

function computeCategoryScores(
    results: ScenarioResult[],
): Record<MemoryCategory, { avg: number; count: number }> {
    const categories: MemoryCategory[] = [
        "topic_recall",
        "error_memory",
        "decision_consistency",
        "detail_retention",
        "cross_association",
    ];

    const scores: Record<MemoryCategory, { avg: number; count: number }> = {} as any;

    for (const cat of categories) {
        const catResults = results.filter(r => r.category === cat);
        scores[cat] = {
            avg: catResults.length > 0
                ? catResults.reduce((s, r) => s + r.totalScore, 0) / catResults.length
                : 0,
            count: catResults.length,
        };
    }

    return scores;
}

// ── 辅助函数 ────────────────────────────────────────────────────

function extractCoreTerms(text: string): string[] {
    // 提取有意义的词汇（去除停用词、标点）
    const stopWords = new Set([
        "的", "了", "是", "在", "和", "与", "而", "但", "或", "不",
        "the", "a", "an", "is", "are", "was", "were", "to", "of", "and",
        "for", "in", "on", "at", "by", "with", "should", "that", "this",
        "应该", "需要", "可以", "已经", "如果", "因为", "所以", "但是",
    ]);

    const terms: string[] = [];

    // 中文词汇（2-6 字连续汉字）
    const cnMatches = text.match(/[\u4e00-\u9fff]{2,6}/g);
    if (cnMatches) {
        for (const w of cnMatches) {
            if (!stopWords.has(w)) terms.push(w);
        }
    }

    // 英文/数字词汇
    const enMatches = text.match(/[a-zA-Z0-9_./:-]+/g);
    if (enMatches) {
        for (const w of enMatches) {
            if (w.length > 1 && !stopWords.has(w.toLowerCase())) terms.push(w);
        }
    }

    return terms;
}

function computeWordOverlap(a: string, b: string): number {
    const wordsA = new Set(extractCoreTerms(a).map(w => w.toLowerCase()));
    const wordsB = new Set(extractCoreTerms(b).map(w => w.toLowerCase()));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    let overlap = 0;
    for (const w of wordsA) {
        if (wordsB.has(w)) overlap++;
    }
    return overlap / Math.max(wordsA.size, wordsB.size);
}
