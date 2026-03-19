import * as fs from "fs";
import * as path from "path";
import * as core from "@actions/core";
import { Result } from "better-result";
import { GitError } from "../errors.js";
import type { Config } from "../config/schema.js";
import type { LLMProvider } from "../providers/types.js";
import { parseEvalFile, parseSkill } from "../skills/parser.js";
import type { BenchmarkResult, ComparisonResult, EvalResult } from "../skills/types.js";
import { calculateNormalizedGain, computeBenchmark } from "./benchmarker.js";
import { runEvals } from "./runner.js";

export async function compareWithBase(
  skillPath: string,
  headBenchmark: BenchmarkResult,
  headEvalResults: EvalResult[],
  config: Config,
  provider: LLMProvider,
  baseBranch: string,
): Promise<ComparisonResult> {
  const skillName = headBenchmark.skill;

  const baseContent = await getBaseFileContent(skillPath, baseBranch);

  if (baseContent.isErr() || baseContent.value === null) {
    core.info(`Skill ${skillName} is new (not in ${baseBranch}), skipping comparison`);
    return { skill: skillName, base_benchmark: null, head_benchmark: headBenchmark, delta: null };
  }

  // Write base content to temp file for parsing
  const tempDir = path.join(process.env.RUNNER_TEMP ?? "/tmp", "skill-eval-base");
  fs.mkdirSync(tempDir, { recursive: true });
  const tempFile = path.join(tempDir, path.basename(skillPath));
  fs.writeFileSync(tempFile, baseContent.value);

  const ext = path.extname(skillPath).toLowerCase();
  const format = ext === ".md" ? "markdown" as const : ext === ".json" ? "json" as const : "yaml" as const;

  const baseSkill = parseSkill({
    absolutePath: tempFile,
    relativePath: path.basename(skillPath),
    type: "skill",
    format,
  });

  // Find eval file (use HEAD evals for fair comparison)
  const evalFile = findEvalFile(skillPath);

  // Cleanup
  try { fs.unlinkSync(tempFile); fs.rmdirSync(tempDir); } catch { /* ignore */ }

  if (!evalFile) {
    return { skill: skillName, base_benchmark: null, head_benchmark: headBenchmark, delta: null };
  }

  const trials = config.eval_trials;
  core.info(`Running evals on base version of ${skillName}...`);
  const baseResults = await runEvals(baseSkill, evalFile, provider, config.parallel_evals, trials);
  const baseBenchmark = computeBenchmark(skillName, baseResults, trials);

  const normalizedGain = calculateNormalizedGain(baseBenchmark.pass_rate, headBenchmark.pass_rate);

  return {
    skill: skillName,
    base_benchmark: baseBenchmark,
    head_benchmark: headBenchmark,
    delta: {
      pass_rate: headBenchmark.pass_rate - baseBenchmark.pass_rate,
      avg_tokens: headBenchmark.avg_tokens - baseBenchmark.avg_tokens,
      avg_latency_ms: headBenchmark.avg_latency_ms - baseBenchmark.avg_latency_ms,
      normalized_gain: normalizedGain ?? undefined,
    },
  };
}

async function getBaseFileContent(
  filePath: string,
  baseBranch: string,
): Promise<Result<string | null, GitError>> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);

  const relativePath = path.relative(process.cwd(), filePath);

  return Result.tryPromise({
    try: async () => {
      const { stdout } = await execFileAsync("git", ["show", `origin/${baseBranch}:${relativePath}`]);
      return stdout;
    },
    catch: () =>
      new GitError({ message: `File not found in ${baseBranch}`, command: "git show", cause: null }),
  }).then((r) => (r.isErr() ? Result.ok(null) : r));
}

function findEvalFile(skillPath: string) {
  const dir = path.dirname(skillPath);
  const base = path.basename(skillPath).replace(/\.(md|yml|yaml|json)$/i, "");

  for (const pattern of [".eval.yml", ".eval.yaml", ".eval.json"]) {
    const evalPath = path.join(dir, base + pattern);
    if (fs.existsSync(evalPath)) {
      return parseEvalFile({
        absolutePath: evalPath,
        relativePath: path.basename(evalPath),
        type: "eval",
        format: pattern.endsWith(".json") ? "json" : "yaml",
      });
    }
  }
  return null;
}
