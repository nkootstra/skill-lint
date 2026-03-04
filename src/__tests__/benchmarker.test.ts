import { describe, expect, it } from "vitest";
import {
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
});
