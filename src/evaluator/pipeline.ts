import * as core from "@actions/core";
import type { Config } from "../config/schema.js";
import type { LLMProvider } from "../providers/types.js";
import type { DetectedFile } from "../skills/detector.js";
import { detectSkillFiles, pairSkillsWithEvals } from "../skills/detector.js";
import { parseEvalFile, parseSkill } from "../skills/parser.js";
import type { EvalResult, LintIssue, SkillEvaluationResult } from "../skills/types.js";
import { computeBenchmark } from "./benchmarker.js";
import { compareWithBase } from "./comparator.js";
import { lintSkill } from "./linter.js";
import { runEvals } from "./runner.js";
import { scanSkillSecurity } from "./security.js";
import { generateSuggestions } from "./suggester.js";

export interface PipelineOptions {
  config: Config;
  provider: LLMProvider;
  changedFiles: string[];
  baseBranch: string;
}

export async function runPipeline(options: PipelineOptions): Promise<SkillEvaluationResult[]> {
  const { config, provider, changedFiles, baseBranch } = options;

  core.info(`Scanning for skill files in: ${config.skills_path}`);
  const detectedFiles = detectSkillFiles(config.skills_path, changedFiles);
  const skillFiles = detectedFiles.filter((f) => f.type === "skill");

  if (skillFiles.length === 0) {
    core.info("No skill files found in changed files.");
    return [];
  }

  core.info(`Found ${skillFiles.length} skill file(s) to evaluate`);
  const pairs = pairSkillsWithEvals(detectedFiles);
  const results: SkillEvaluationResult[] = [];

  for (const [skillFile, evalFile] of pairs) {
    results.push(await evaluateSkill(skillFile, evalFile, config, provider, baseBranch));
  }

  return results;
}

async function evaluateSkill(
  skillFile: DetectedFile,
  evalDetected: DetectedFile | null,
  config: Config,
  provider: LLMProvider,
  baseBranch: string,
): Promise<SkillEvaluationResult> {
  const skill = parseSkill(skillFile);
  core.info(`\nEvaluating: ${skill.metadata.title} (${skill.relativePath})`);

  // Step 1: Security scan
  let securityIssues: LintIssue[] = [];
  if (config.rubric.require_security) {
    core.info("  [1/6] Security scan...");
    securityIssues = scanSkillSecurity(skill);
    if (securityIssues.length > 0) {
      core.info(`  Found ${securityIssues.length} security issue(s)`);
    } else {
      core.info("  No security issues found");
    }
  } else {
    core.info("  [1/6] Security scan (disabled)");
  }

  // Step 2: Lint
  core.info("  [2/6] Linting...");
  const lintIssues = await lintSkill(skill, config.rubric, provider);
  core.info(`  Found ${lintIssues.length} lint issue(s)`);

  // Step 3: Run evals
  let evalResults: EvalResult[] = [];
  const trials = config.eval_trials;
  if (evalDetected) {
    core.info(`  [3/6] Running evaluations${trials > 1 ? ` (${trials} trials each)` : ""}...`);
    const evalFile = parseEvalFile(evalDetected);
    evalResults = await runEvals(skill, evalFile, provider, config.parallel_evals, trials);
    core.info(`  Evals: ${evalResults.filter((r) => r.passed).length}/${evalResults.length} passed`);
  } else {
    core.info("  [3/6] No eval file, skipping");
  }

  // Step 4: Benchmark
  core.info("  [4/6] Benchmarking...");
  const benchmark = computeBenchmark(skill.metadata.title, evalResults, trials);

  // Step 5: A/B comparison
  let comparison = null;
  if (evalResults.length > 0) {
    core.info("  [5/6] A/B comparison...");
    comparison = await compareWithBase(skillFile.absolutePath, benchmark, evalResults, config, provider, baseBranch);
  } else {
    core.info("  [5/6] Skipping A/B (no evals)");
  }

  // Step 6: Suggestions
  core.info("  [6/6] Generating suggestions...");
  const suggestions = await generateSuggestions(skill, [...securityIssues, ...lintIssues], evalResults, provider);
  core.info(`  ${suggestions.length} suggestion(s)`);

  return { skill, lint_issues: [...securityIssues, ...lintIssues], eval_results: evalResults, benchmark, comparison, suggestions };
}
