import type { BenchmarkResult, EvalResult } from "../skills/types.js";

export function computeBenchmark(
  skillName: string,
  results: EvalResult[],
): BenchmarkResult {
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;

  const totalTokens = results.reduce((sum, r) => sum + r.tokens_used, 0);
  const totalLatency = results.reduce((sum, r) => sum + r.latency_ms, 0);

  return {
    skill: skillName,
    total_tests: total,
    passed,
    failed: total - passed,
    pass_rate: total > 0 ? passed / total : 0,
    avg_tokens: total > 0 ? Math.round(totalTokens / total) : 0,
    avg_latency_ms: total > 0 ? Math.round(totalLatency / total) : 0,
    total_tokens: totalTokens,
  };
}

export function formatBenchmarkTable(benchmarks: BenchmarkResult[]): string {
  if (benchmarks.length === 0) return "No benchmarks to display.";

  const rows = benchmarks.map((b) => {
    const passIcon = b.pass_rate >= 1.0 ? "pass" : b.pass_rate >= 0.5 ? "partial" : "fail";
    return `| ${b.skill} | ${b.passed}/${b.total_tests} | ${(b.pass_rate * 100).toFixed(0)}% ${passIcon} | ${b.avg_tokens} | ${b.avg_latency_ms}ms |`;
  });

  return [
    "| Skill | Tests | Pass Rate | Avg Tokens | Avg Latency |",
    "|-------|-------|-----------|------------|-------------|",
    ...rows,
  ].join("\n");
}

export function formatComparisonTable(
  comparisons: Array<{
    skill: string;
    base: BenchmarkResult | null;
    head: BenchmarkResult;
    delta: { pass_rate: number; avg_tokens: number; avg_latency_ms: number } | null;
  }>,
): string {
  if (comparisons.length === 0) return "";

  const rows = comparisons
    .filter((c) => c.delta !== null)
    .map((c) => {
      const d = c.delta!;
      const passRateDelta = formatDelta(d.pass_rate * 100, "%", true);
      const tokenDelta = formatDelta(d.avg_tokens, "", false);
      const latencyDelta = formatDelta(d.avg_latency_ms, "ms", false);

      return `| ${c.skill} | ${((c.base?.pass_rate ?? 0) * 100).toFixed(0)}% -> ${(c.head.pass_rate * 100).toFixed(0)}% | ${passRateDelta} | ${tokenDelta} | ${latencyDelta} |`;
    });

  if (rows.length === 0) return "";

  return [
    "\n### A/B Comparison (vs base branch)\n",
    "| Skill | Pass Rate | Delta | Token Delta | Latency Delta |",
    "|-------|-----------|-------|-------------|---------------|",
    ...rows,
  ].join("\n");
}

function formatDelta(
  value: number,
  suffix: string,
  higherIsBetter: boolean,
): string {
  if (Math.abs(value) < 0.01) return `~0${suffix}`;

  const sign = value > 0 ? "+" : "";
  const formatted = `${sign}${value.toFixed(1)}${suffix}`;

  if (higherIsBetter) {
    return value > 0 ? `${formatted} (improved)` : value < 0 ? `${formatted} (regressed)` : formatted;
  } else {
    return value < 0 ? `${formatted} (improved)` : value > 0 ? `${formatted} (regressed)` : formatted;
  }
}
