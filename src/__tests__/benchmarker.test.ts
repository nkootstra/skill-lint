import { describe, expect, it } from "vitest";
import {
  calculateNormalizedGain,
  calculatePassAtK,
  calculatePassPowK,
  computeBenchmark,
  formatBenchmarkTable,
  formatComparisonTable,
} from "../evaluator/benchmarker.js";
import type { EvalResult } from "../skills/types.js";

function makeEvalResult(overrides: Partial<EvalResult> = {}): EvalResult {
  return {
    testCase: {
      name: "test",
      prompt: "test prompt",
      expected: "expected output",
    },
    passed: true,
    output: "output",
    tokens_used: 100,
    latency_ms: 500,
    ...overrides,
  };
}

describe("computeBenchmark", () => {
  it("should compute correct stats for passing tests", () => {
    const results = [
      makeEvalResult({ passed: true, tokens_used: 100, latency_ms: 200 }),
      makeEvalResult({ passed: true, tokens_used: 200, latency_ms: 400 }),
    ];

    const benchmark = computeBenchmark("test-skill", results);
    expect(benchmark.total_tests).toBe(2);
    expect(benchmark.passed).toBe(2);
    expect(benchmark.failed).toBe(0);
    expect(benchmark.pass_rate).toBe(1.0);
    expect(benchmark.avg_tokens).toBe(150);
    expect(benchmark.avg_latency_ms).toBe(300);
    expect(benchmark.total_tokens).toBe(300);
  });

  it("should compute correct stats with failures", () => {
    const results = [
      makeEvalResult({ passed: true }),
      makeEvalResult({ passed: false }),
      makeEvalResult({ passed: false }),
    ];

    const benchmark = computeBenchmark("test-skill", results);
    expect(benchmark.passed).toBe(1);
    expect(benchmark.failed).toBe(2);
    expect(benchmark.pass_rate).toBeCloseTo(1 / 3);
  });

  it("should handle empty results", () => {
    const benchmark = computeBenchmark("test-skill", []);
    expect(benchmark.total_tests).toBe(0);
    expect(benchmark.pass_rate).toBe(0);
    expect(benchmark.avg_tokens).toBe(0);
  });

  it("should not include pass@k/pass^k when trials=1 (default)", () => {
    const results = [makeEvalResult({ passed: true })];
    const benchmark = computeBenchmark("test-skill", results);

    expect(benchmark.pass_at_k).toBeUndefined();
    expect(benchmark.pass_pow_k).toBeUndefined();
    expect(benchmark.trials_per_test).toBeUndefined();
  });

  it("should include pass@k/pass^k when trials > 1", () => {
    const results = [
      makeEvalResult({ passed: true }),
      makeEvalResult({ passed: true }),
      makeEvalResult({ passed: false }),
      makeEvalResult({ passed: true }),
      makeEvalResult({ passed: false }),
    ];

    const benchmark = computeBenchmark("test-skill", results, 5);

    expect(benchmark.pass_at_k).toBeDefined();
    expect(benchmark.pass_pow_k).toBeDefined();
    expect(benchmark.trials_per_test).toBe(5);
    // 3 out of 5 passed
    expect(benchmark.pass_rate).toBeCloseTo(0.6);
    // pass@5: probability of at least 1 success is very high
    expect(benchmark.pass_at_k!).toBeGreaterThan(0.9);
    // pass^5: probability of all 5 succeeding is lower
    expect(benchmark.pass_pow_k!).toBeLessThan(0.5);
  });
});

describe("calculatePassAtK", () => {
  it("returns 1.0 when all trials pass", () => {
    expect(calculatePassAtK(5, 5, 5)).toBe(1.0);
  });

  it("returns 0 when no trials pass", () => {
    expect(calculatePassAtK(5, 0, 5)).toBe(0);
  });

  it("returns probability of at least 1 success", () => {
    // 3 out of 5 pass, k=5: very likely to see at least 1 success
    const result = calculatePassAtK(5, 3, 5);
    expect(result).toBeGreaterThan(0.95);
    expect(result).toBeLessThanOrEqual(1.0);
  });

  it("handles edge case n=0", () => {
    expect(calculatePassAtK(0, 0, 0)).toBe(0);
  });

  it("is 1.0 when successes make failure impossible for k trials", () => {
    // 4 successes out of 5 trials, k=2: can't pick 2 failures from just 1 failure
    expect(calculatePassAtK(5, 4, 2)).toBe(1.0);
  });
});

describe("calculatePassPowK", () => {
  it("returns 1.0 when all trials pass", () => {
    expect(calculatePassPowK(5, 5, 5)).toBe(1.0);
  });

  it("returns 0 when no trials pass", () => {
    expect(calculatePassPowK(5, 0, 5)).toBe(0);
  });

  it("returns (c/n)^k", () => {
    // 4 out of 5 pass, k=3: (0.8)^3 = 0.512
    expect(calculatePassPowK(5, 4, 3)).toBeCloseTo(0.512);
  });

  it("decreases with higher k", () => {
    const k3 = calculatePassPowK(10, 8, 3);
    const k5 = calculatePassPowK(10, 8, 5);
    const k10 = calculatePassPowK(10, 8, 10);
    expect(k3).toBeGreaterThan(k5);
    expect(k5).toBeGreaterThan(k10);
  });
});

describe("calculateNormalizedGain", () => {
  it("returns improvement relative to remaining headroom", () => {
    // 50% -> 75% = gain of 0.5 (used half the remaining headroom)
    expect(calculateNormalizedGain(0.5, 0.75)).toBeCloseTo(0.5);
  });

  it("returns 1.0 for perfect improvement", () => {
    // 50% -> 100% = gain of 1.0
    expect(calculateNormalizedGain(0.5, 1.0)).toBeCloseTo(1.0);
  });

  it("returns 0 for no change", () => {
    expect(calculateNormalizedGain(0.5, 0.5)).toBeCloseTo(0);
  });

  it("returns negative for regression", () => {
    // 80% -> 60% = negative gain
    expect(calculateNormalizedGain(0.8, 0.6)).toBeLessThan(0);
  });

  it("returns null when base is already 100%", () => {
    expect(calculateNormalizedGain(1.0, 1.0)).toBeNull();
  });
});

describe("formatBenchmarkTable", () => {
  it("should format a markdown table", () => {
    const benchmarks = [
      computeBenchmark("skill-a", [
        makeEvalResult({ passed: true, tokens_used: 100, latency_ms: 200 }),
      ]),
    ];

    const table = formatBenchmarkTable(benchmarks);
    expect(table).toContain("| Skill |");
    expect(table).toContain("skill-a");
    expect(table).toContain("1/1");
  });

  it("should handle empty benchmarks", () => {
    expect(formatBenchmarkTable([])).toBe("No benchmarks to display.");
  });

  it("should include pass@k/pass^k columns when trials > 1", () => {
    const benchmarks = [
      computeBenchmark(
        "skill-a",
        [
          makeEvalResult({ passed: true }),
          makeEvalResult({ passed: true }),
          makeEvalResult({ passed: false }),
        ],
        3,
      ),
    ];

    const table = formatBenchmarkTable(benchmarks);
    expect(table).toContain("pass@k");
    expect(table).toContain("pass^k");
  });

  it("should not include pass@k/pass^k columns when trials = 1", () => {
    const benchmarks = [
      computeBenchmark("skill-a", [makeEvalResult({ passed: true })]),
    ];

    const table = formatBenchmarkTable(benchmarks);
    expect(table).not.toContain("pass@k");
    expect(table).not.toContain("pass^k");
  });
});

describe("formatComparisonTable", () => {
  it("should format comparison with deltas", () => {
    const comparisons = [
      {
        skill: "test-skill",
        base: computeBenchmark("test-skill", [
          makeEvalResult({ passed: true, tokens_used: 200, latency_ms: 500 }),
        ]),
        head: computeBenchmark("test-skill", [
          makeEvalResult({ passed: true, tokens_used: 150, latency_ms: 300 }),
        ]),
        delta: { pass_rate: 0, avg_tokens: -50, avg_latency_ms: -200 },
      },
    ];

    const table = formatComparisonTable(comparisons);
    expect(table).toContain("A/B Comparison");
    expect(table).toContain("test-skill");
    expect(table).toContain("improved");
  });

  it("should return empty for no comparisons", () => {
    expect(formatComparisonTable([])).toBe("");
  });

  it("should include normalized gain column when present", () => {
    const comparisons = [
      {
        skill: "test-skill",
        base: computeBenchmark("test-skill", [
          makeEvalResult({ passed: true, tokens_used: 200, latency_ms: 500 }),
          makeEvalResult({ passed: false, tokens_used: 200, latency_ms: 500 }),
        ]),
        head: computeBenchmark("test-skill", [
          makeEvalResult({ passed: true, tokens_used: 150, latency_ms: 300 }),
          makeEvalResult({ passed: true, tokens_used: 150, latency_ms: 300 }),
        ]),
        delta: { pass_rate: 0.5, avg_tokens: -50, avg_latency_ms: -200, normalized_gain: 1.0 },
      },
    ];

    const table = formatComparisonTable(comparisons);
    expect(table).toContain("Norm. Gain");
    expect(table).toContain("100%");
  });

  it("should not include normalized gain column when absent", () => {
    const comparisons = [
      {
        skill: "test-skill",
        base: computeBenchmark("test-skill", [makeEvalResult()]),
        head: computeBenchmark("test-skill", [makeEvalResult()]),
        delta: { pass_rate: 0, avg_tokens: 0, avg_latency_ms: 0 },
      },
    ];

    const table = formatComparisonTable(comparisons);
    expect(table).not.toContain("Norm. Gain");
  });
});
