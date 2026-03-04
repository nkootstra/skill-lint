import type { BenchmarkResult, EvalResult } from "../skills/types.js";

/**
 * Calculate pass@k: probability of at least 1 success in k trials.
 * Uses the unbiased estimator: 1 - C(n-c, k) / C(n, k)
 * where n = total trials, c = successes, k = attempts.
 */
export function calculatePassAtK(n: number, c: number, k: number): number {
  if (n === 0 || k === 0) return 0;
  if (c >= n) return 1.0;
  if (n - c < k) return 1.0;
  let result = 1.0;
  for (let i = 0; i < k; i++) {
    result *= (n - c - i) / (n - i);
  }
  return 1.0 - result;
}

/**
 * Calculate pass^k: probability that all k trials succeed.
 * Estimated as (c/n)^k.
 *
 * A task with pass@5=100% but pass^5=30% indicates the agent *can* do it
 * but is flaky — worth investigating.
 */
export function calculatePassPowK(n: number, c: number, k: number): number {
  if (n === 0) return 0;
  const p = c / n;
  return Math.pow(p, k);
}

/**
 * Calculate normalized gain: relative improvement accounting for baseline difficulty.
 * Formula: (head - base) / (1 - base)
 *
 * A 10% improvement from 50% to 60% (gain=0.20) is less impressive than
 * 10% improvement from 90% to 100% (gain=1.0).
 *
 * Returns null when base is already at 100% (no room for improvement).
 */
export function calculateNormalizedGain(
  basePassRate: number,
  headPassRate: number,
): number | null {
  if (basePassRate >= 1.0) return null;
  return (headPassRate - basePassRate) / (1.0 - basePassRate);
}

export function computeBenchmark(
  skillName: string,
  results: EvalResult[],
  trialsPerTest = 1,
): BenchmarkResult {
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;

  const totalTokens = results.reduce((sum, r) => sum + r.tokens_used, 0);
  const totalLatency = results.reduce((sum, r) => sum + r.latency_ms, 0);

  const benchmark: BenchmarkResult = {
    skill: skillName,
    total_tests: total,
    passed,
    failed: total - passed,
    pass_rate: total > 0 ? passed / total : 0,
    avg_tokens: total > 0 ? Math.round(totalTokens / total) : 0,
    avg_latency_ms: total > 0 ? Math.round(totalLatency / total) : 0,
    total_tokens: totalTokens,
  };

  // Only include pass@k/pass^k when multi-trial is active
  if (trialsPerTest > 1) {
    benchmark.pass_at_k = calculatePassAtK(total, passed, trialsPerTest);
    benchmark.pass_pow_k = calculatePassPowK(total, passed, trialsPerTest);
    benchmark.trials_per_test = trialsPerTest;
  }

  return benchmark;
}

export function formatBenchmarkTable(benchmarks: BenchmarkResult[]): string {
  if (benchmarks.length === 0) return "No benchmarks to display.";

  const hasTrials = benchmarks.some((b) => b.trials_per_test && b.trials_per_test > 1);

  const header = hasTrials
    ? "| Skill | Tests | Pass Rate | pass@k | pass^k | Avg Tokens | Avg Latency |"
    : "| Skill | Tests | Pass Rate | Avg Tokens | Avg Latency |";

  const separator = hasTrials
    ? "|-------|-------|-----------|--------|--------|------------|-------------|"
    : "|-------|-------|-----------|------------|-------------|";

  const rows = benchmarks.map((b) => {
    const passIcon = b.pass_rate >= 1.0 ? "pass" : b.pass_rate >= 0.5 ? "partial" : "fail";
    const base = `| ${b.skill} | ${b.passed}/${b.total_tests} | ${(b.pass_rate * 100).toFixed(0)}% ${passIcon}`;

    if (hasTrials) {
      const passAtK = b.pass_at_k !== undefined ? `${(b.pass_at_k * 100).toFixed(0)}%` : "-";
      const passPowK = b.pass_pow_k !== undefined ? `${(b.pass_pow_k * 100).toFixed(0)}%` : "-";
      return `${base} | ${passAtK} | ${passPowK} | ${b.avg_tokens} | ${b.avg_latency_ms}ms |`;
    }

    return `${base} | ${b.avg_tokens} | ${b.avg_latency_ms}ms |`;
  });

  return [header, separator, ...rows].join("\n");
}

export function formatComparisonTable(
  comparisons: Array<{
    skill: string;
    base: BenchmarkResult | null;
    head: BenchmarkResult;
    delta: { pass_rate: number; avg_tokens: number; avg_latency_ms: number; normalized_gain?: number } | null;
  }>,
): string {
  if (comparisons.length === 0) return "";

  const hasNormalizedGain = comparisons.some((c) => c.delta?.normalized_gain !== undefined);

  const rows = comparisons
    .filter((c) => c.delta !== null)
    .map((c) => {
      const d = c.delta!;
      const passRateDelta = formatDelta(d.pass_rate * 100, "%", true);
      const tokenDelta = formatDelta(d.avg_tokens, "", false);
      const latencyDelta = formatDelta(d.avg_latency_ms, "ms", false);

      let row = `| ${c.skill} | ${((c.base?.pass_rate ?? 0) * 100).toFixed(0)}% -> ${(c.head.pass_rate * 100).toFixed(0)}% | ${passRateDelta} | ${tokenDelta} | ${latencyDelta}`;

      if (hasNormalizedGain) {
        const gain = d.normalized_gain !== undefined
          ? `${(d.normalized_gain * 100).toFixed(0)}%`
          : "N/A";
        row += ` | ${gain}`;
      }

      return `${row} |`;
    });

  if (rows.length === 0) return "";

  const header = hasNormalizedGain
    ? "| Skill | Pass Rate | Delta | Token Delta | Latency Delta | Norm. Gain |"
    : "| Skill | Pass Rate | Delta | Token Delta | Latency Delta |";

  const separator = hasNormalizedGain
    ? "|-------|-----------|-------|-------------|---------------|------------|"
    : "|-------|-----------|-------|-------------|---------------|";

  return [
    "\n### A/B Comparison (vs base branch)\n",
    header,
    separator,
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
