import * as core from "@actions/core";
import type { Config } from "../config/schema.js";
import type { LLMProvider } from "../providers/types.js";
import type { DetectedFile } from "../skills/detector.js";
import {
  detectSkillFiles,
  pairSkillsWithEvals,
} from "../skills/detector.js";
import { parseEvalFile, parseSkill } from "../skills/parser.js";
import type { SkillEvaluationResult } from "../skills/types.js";
import { computeBenchmark } from "./benchmarker.js";
import { compareWithBase } from "./comparator.js";
import { lintSkill } from "./linter.js";
import { runEvals } from "./runner.js";
import { generateSuggestions } from "./suggester.js";

export interface PipelineOptions {
  config: Config;
  provider: LLMProvider;
  changedFiles: string[];
  baseBranch: string;
}

export async function runPipeline(
  options: PipelineOptions,
): Promise<SkillEvaluationResult[]> {
  const { config, provider, changedFiles, baseBranch } = options;

  core.info(`Scanning for skill files in: ${config.skills_path}`);
  const detectedFiles = detectSkillFiles(config.skills_path, changedFiles);

  const skillFiles = detectedFiles.filter((f) => f.type === "skill");
  if (skillFiles.length === 0) {
    core.info("No skill files found in changed files. Nothing to evaluate.");
    return [];
  }

  core.info(`Found ${skillFiles.length} skill file(s) to evaluate`);

  const pairs = pairSkillsWithEvals(detectedFiles);
  const results: SkillEvaluationResult[] = [];

  for (const [skillFile, evalFile] of pairs) {
    const result = await evaluateSingleSkill(
      skillFile,
      evalFile,
      config,
      provider,
      baseBranch,
    );
    results.push(result);
  }

  return results;
}

async function evaluateSingleSkill(
  skillFile: DetectedFile,
  evalDetected: DetectedFile | null,
  config: Config,
  provider: LLMProvider,
  baseBranch: string,
): Promise<SkillEvaluationResult> {
  const skill = parseSkill(skillFile);
  core.info(`\nEvaluating skill: ${skill.metadata.title} (${skill.relativePath})`);

  // Step 1: Lint
  core.info("  Step 1/5: Linting...");
  const lintIssues = await lintSkill(skill, config.rubric, provider);
  core.info(`  Found ${lintIssues.length} lint issue(s)`);

  // Step 2: Run evals
  let evalResults: import("../skills/types.js").EvalResult[] = [];
  if (evalDetected) {
    core.info("  Step 2/5: Running evaluations...");
    const evalFile = parseEvalFile(evalDetected);
    evalResults = await runEvals(
      skill,
      evalFile,
      provider,
      config.parallel_evals,
    );
    const passed = evalResults.filter((r) => r.passed).length;
    core.info(`  Evals: ${passed}/${evalResults.length} passed`);
  } else {
    core.info("  Step 2/5: No eval file found, skipping evaluations");
  }

  // Step 3: Benchmark
  core.info("  Step 3/5: Computing benchmarks...");
  const benchmark = computeBenchmark(skill.metadata.title, evalResults);

  // Step 4: A/B comparison
  let comparison = null;
  if (evalResults.length > 0) {
    core.info("  Step 4/5: Running A/B comparison with base branch...");
    comparison = await compareWithBase(
      skillFile.absolutePath,
      benchmark,
      evalResults,
      config,
      provider,
      baseBranch,
    );
  } else {
    core.info("  Step 4/5: Skipping A/B comparison (no evals)");
  }

  // Step 5: Generate suggestions
  core.info("  Step 5/5: Generating suggestions...");
  const suggestions = await generateSuggestions(
    skill,
    lintIssues,
    evalResults,
    provider,
  );
  core.info(`  Generated ${suggestions.length} suggestion(s)`);

  return {
    skill,
    lint_issues: lintIssues,
    eval_results: evalResults,
    benchmark,
    comparison,
    suggestions,
  };
}
