import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import * as core from "@actions/core";
import type { Config } from "../config/schema.js";
import type { LLMProvider } from "../providers/types.js";
import { detectSkillFiles, pairSkillsWithEvals } from "../skills/detector.js";
import { parseEvalFile, parseSkill } from "../skills/parser.js";
import type {
  BenchmarkResult,
  ComparisonResult,
  EvalResult,
} from "../skills/types.js";
import { computeBenchmark } from "./benchmarker.js";
import { runEvals } from "./runner.js";

const execFileAsync = promisify(execFile);

/**
 * A/B comparison: runs evals on the base branch version of a skill
 * and compares results against the head (PR) version.
 */
export async function compareWithBase(
  skillPath: string,
  headBenchmark: BenchmarkResult,
  headEvalResults: EvalResult[],
  config: Config,
  provider: LLMProvider,
  baseBranch: string,
): Promise<ComparisonResult> {
  const skillName = headBenchmark.skill;

  try {
    // Get the base branch version of the skill file
    const baseContent = await getBaseFileContent(skillPath, baseBranch);

    if (!baseContent) {
      core.info(
        `Skill ${skillName} is new (not present in ${baseBranch}), skipping comparison`,
      );
      return {
        skill: skillName,
        base_benchmark: null,
        head_benchmark: headBenchmark,
        delta: null,
      };
    }

    // Write base content to a temp file for parsing
    const tempDir = path.join(
      process.env.RUNNER_TEMP ?? "/tmp",
      "skill-lint-base",
    );
    fs.mkdirSync(tempDir, { recursive: true });
    const tempFile = path.join(tempDir, path.basename(skillPath));
    fs.writeFileSync(tempFile, baseContent);

    // Detect and parse the base version
    const ext = path.extname(skillPath).toLowerCase();
    const format =
      ext === ".md" ? "markdown" : ext === ".json" ? "json" : "yaml";

    const baseSkill = parseSkill({
      absolutePath: tempFile,
      relativePath: path.basename(skillPath),
      type: "skill",
      format,
    });

    // Get eval file content from base (use same evals for fair comparison)
    const evalPatterns = [".eval.yml", ".eval.yaml", ".eval.json"];
    let baseEvalFile = null;

    // Use the HEAD eval file for both base and head (fair comparison)
    const headSkillDir = path.dirname(skillPath);
    const headSkillBase = path
      .basename(skillPath)
      .replace(/\.(md|yml|yaml|json)$/i, "");

    for (const pattern of evalPatterns) {
      const evalPath = path.join(headSkillDir, headSkillBase + pattern);
      if (fs.existsSync(evalPath)) {
        const evalFormat = pattern.endsWith(".json") ? "json" : "yaml";
        baseEvalFile = parseEvalFile({
          absolutePath: evalPath,
          relativePath: path.basename(evalPath),
          type: "eval",
          format: evalFormat,
        });
        break;
      }
    }

    if (!baseEvalFile || baseEvalFile.tests.length === 0) {
      return {
        skill: skillName,
        base_benchmark: null,
        head_benchmark: headBenchmark,
        delta: null,
      };
    }

    // Run evals on base version
    core.info(`Running evals on base version of ${skillName}...`);
    const baseResults = await runEvals(
      baseSkill,
      baseEvalFile,
      provider,
      config.parallel_evals,
    );
    const baseBenchmark = computeBenchmark(skillName, baseResults);

    // Clean up temp file
    try {
      fs.unlinkSync(tempFile);
      fs.rmdirSync(tempDir);
    } catch {
      // ignore cleanup errors
    }

    return {
      skill: skillName,
      base_benchmark: baseBenchmark,
      head_benchmark: headBenchmark,
      delta: {
        pass_rate: headBenchmark.pass_rate - baseBenchmark.pass_rate,
        avg_tokens: headBenchmark.avg_tokens - baseBenchmark.avg_tokens,
        avg_latency_ms:
          headBenchmark.avg_latency_ms - baseBenchmark.avg_latency_ms,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.warning(`Failed to compare with base for ${skillName}: ${message}`);

    return {
      skill: skillName,
      base_benchmark: null,
      head_benchmark: headBenchmark,
      delta: null,
    };
  }
}

async function getBaseFileContent(
  filePath: string,
  baseBranch: string,
): Promise<string | null> {
  try {
    const relativePath = path.relative(process.cwd(), filePath);
    const { stdout } = await execFileAsync("git", [
      "show",
      `origin/${baseBranch}:${relativePath}`,
    ]);
    return stdout;
  } catch {
    return null;
  }
}
