import * as core from "@actions/core";
import { execFile } from "child_process";
import { promisify } from "util";
import { Result } from "better-result";
import { ProviderParseError } from "../errors.js";
import * as fs from "fs";
import * as path from "path";
import type { LLMProvider } from "../providers/types.js";
import type { EvalFile, EvalResult, EvalTestCase, GraderCheck, GraderConfig, GraderResult, Skill } from "../skills/types.js";
import { extractJSON } from "../utils/json.js";

const execFileAsync = promisify(execFile);

export async function runEvals(
  skill: Skill,
  evalFile: EvalFile,
  provider: LLMProvider,
  parallelLimit = 3,
  trials = 1,
): Promise<EvalResult[]> {
  const results: EvalResult[] = [];

  for (let i = 0; i < evalFile.tests.length; i += parallelLimit) {
    const chunk = evalFile.tests.slice(i, i + parallelLimit);
    const chunkResults = await Promise.all(
      chunk.flatMap((testCase) =>
        Array.from({ length: trials }, (_, trialIndex) =>
          runSingleEval(skill, testCase, provider, trials > 1 ? trialIndex + 1 : undefined),
        ),
      ),
    );
    results.push(...chunkResults);
  }

  return results;
}

async function runSingleEval(
  skill: Skill,
  testCase: EvalTestCase,
  provider: LLMProvider,
  trialNumber?: number,
): Promise<EvalResult> {
  const trialLabel = trialNumber !== undefined ? ` (trial ${trialNumber})` : "";
  core.info(`  Running eval: ${testCase.name}${trialLabel}`);

  const systemPrompt = `You are an AI assistant with the following skill activated:

Title: ${skill.metadata.title}
${skill.metadata.description ? `Description: ${skill.metadata.description}` : ""}

Instructions:
${skill.instructions}

Follow the skill instructions precisely when responding.`;

  // Step 1: Get the skill's response, injecting any referenced files into the prompt
  const userContent = injectTestFiles(testCase, skill.filePath);
  const skillResponse = await provider.complete([
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ]);

  if (skillResponse.isErr()) {
    core.warning(`  Eval "${testCase.name}"${trialLabel} provider error: ${skillResponse.error.message}`);
    return {
      testCase,
      passed: false,
      output: "",
      reasoning: `Provider error: ${skillResponse.error.message}`,
      tokens_used: 0,
      latency_ms: 0,
    };
  }

  const response = skillResponse.value;

  // Step 2: Use weighted graders if defined, otherwise fall back to legacy behavior
  if (testCase.graders && testCase.graders.length > 0) {
    return runWithGraders(testCase, response.content, response.usage.total_tokens, response.latency_ms, provider);
  }

  // Legacy path: hard constraints then LLM-as-judge
  const hardCheck = checkHardConstraints(testCase, response.content);
  if (hardCheck) {
    return {
      testCase,
      ...hardCheck,
      output: response.content,
      tokens_used: response.usage.total_tokens,
      latency_ms: response.latency_ms,
    };
  }

  // Step 3: LLM-as-judge for semantic evaluation
  const judgment = await judgeResponse(testCase, response.content, provider);

  return {
    testCase,
    passed: judgment.passed,
    output: response.content,
    score: judgment.score,
    reasoning: judgment.reasoning,
    tokens_used: response.usage.total_tokens + judgment.tokens_used,
    latency_ms: response.latency_ms + judgment.latency_ms,
  };
}

// --- Weighted graders (new) ---

async function runWithGraders(
  testCase: EvalTestCase,
  output: string,
  baseTokens: number,
  baseLatency: number,
  provider: LLMProvider,
): Promise<EvalResult> {
  const graderResults: GraderResult[] = [];
  let extraTokens = 0;
  let extraLatency = 0;

  for (const grader of testCase.graders!) {
    const result = await runSingleGrader(grader, testCase, output, provider);
    graderResults.push(result.graderResult);
    extraTokens += result.tokens;
    extraLatency += result.latency;
  }

  // Compute weighted score
  const totalWeight = graderResults.reduce((sum, r) => sum + r.weight, 0);
  const weightedScore = totalWeight > 0
    ? graderResults.reduce((sum, r) => sum + r.score * r.weight, 0) / totalWeight
    : 0;

  const passed = weightedScore >= 0.5;

  const reasoning = graderResults
    .map((r) => `[${r.grader_type}] score=${r.score.toFixed(2)}: ${r.details}`)
    .join("; ");

  return {
    testCase,
    passed,
    output,
    score: weightedScore,
    reasoning,
    tokens_used: baseTokens + extraTokens,
    latency_ms: baseLatency + extraLatency,
    grader_results: graderResults,
  };
}

async function runSingleGrader(
  grader: GraderConfig,
  testCase: EvalTestCase,
  output: string,
  provider: LLMProvider,
): Promise<{ graderResult: GraderResult; tokens: number; latency: number }> {
  switch (grader.type) {
    case "hard_constraints":
      return runHardConstraintGrader(grader, output);
    case "llm_rubric":
      return runLLMRubricGrader(grader, testCase, output, provider);
    case "script":
      return runScriptGrader(grader, output);
    default:
      return {
        graderResult: {
          grader_type: grader.type,
          score: 0,
          weight: grader.weight,
          details: `Unknown grader type: ${grader.type}`,
        },
        tokens: 0,
        latency: 0,
      };
  }
}

function runHardConstraintGrader(
  grader: GraderConfig,
  output: string,
): { graderResult: GraderResult; tokens: number; latency: number } {
  const outputLower = output.toLowerCase();
  const issues: string[] = [];

  if (grader.match_pattern) {
    if (!new RegExp(grader.match_pattern, "is").test(output)) {
      issues.push(`Does not match pattern: ${grader.match_pattern}`);
    }
  }

  if (grader.required_keywords?.length) {
    const missing = grader.required_keywords.filter((kw) => !outputLower.includes(kw.toLowerCase()));
    if (missing.length > 0) {
      issues.push(`Missing keywords: ${missing.join(", ")}`);
    }
  }

  if (grader.forbidden_keywords?.length) {
    const found = grader.forbidden_keywords.filter((kw) => outputLower.includes(kw.toLowerCase()));
    if (found.length > 0) {
      issues.push(`Contains forbidden keywords: ${found.join(", ")}`);
    }
  }

  const score = issues.length === 0 ? 1.0 : 0.0;

  return {
    graderResult: {
      grader_type: "hard_constraints",
      score,
      weight: grader.weight,
      details: issues.length === 0 ? "All constraints passed" : issues.join("; "),
    },
    tokens: 0,
    latency: 0,
  };
}

async function runLLMRubricGrader(
  grader: GraderConfig,
  testCase: EvalTestCase,
  output: string,
  provider: LLMProvider,
): Promise<{ graderResult: GraderResult; tokens: number; latency: number }> {
  const expected = grader.expected ?? testCase.expected;
  const judgment = await judgeResponse(
    { ...testCase, expected },
    output,
    provider,
  );

  return {
    graderResult: {
      grader_type: "llm_rubric",
      score: judgment.score ?? (judgment.passed ? 1.0 : 0.0),
      weight: grader.weight,
      details: judgment.reasoning,
    },
    tokens: judgment.tokens_used,
    latency: judgment.latency_ms,
  };
}

async function runScriptGrader(
  grader: GraderConfig,
  output: string,
): Promise<{ graderResult: GraderResult; tokens: number; latency: number }> {
  if (!grader.command) {
    return {
      graderResult: {
        grader_type: "script",
        score: 0,
        weight: grader.weight,
        details: "No command specified for script grader",
      },
      tokens: 0,
      latency: 0,
    };
  }

  const startTime = Date.now();

  try {
    const { stdout } = await execFileAsync("bash", ["-c", grader.command], {
      env: { ...process.env, SKILL_EVAL_OUTPUT: output, SKILL_LINT_OUTPUT: output },
      timeout: 30_000,
    });

    const latency = Date.now() - startTime;
    const { score, details, checks } = parseScriptGraderOutput(stdout);

    return {
      graderResult: {
        grader_type: "script",
        score,
        weight: grader.weight,
        details,
        checks,
      },
      tokens: 0,
      latency,
    };
  } catch (err: unknown) {
    const latency = Date.now() - startTime;
    const message = err instanceof Error ? err.message : String(err);

    return {
      graderResult: {
        grader_type: "script",
        score: 0,
        weight: grader.weight,
        details: `Script failed: ${message}`,
      },
      tokens: 0,
      latency,
    };
  }
}

// --- File injection ---

function injectTestFiles(testCase: EvalTestCase, skillFilePath: string): string {
  if (!testCase.files || testCase.files.length === 0) {
    return testCase.prompt;
  }

  const skillDir = path.dirname(skillFilePath);
  const fileSections: string[] = [];

  for (const filePath of testCase.files) {
    const resolved = path.resolve(skillDir, filePath);
    try {
      const content = fs.readFileSync(resolved, "utf-8");
      fileSections.push(`### ${filePath}\n\`\`\`\n${content}\n\`\`\``);
    } catch {
      core.warning(`  File not found for eval "${testCase.name}": ${resolved}`);
    }
  }

  if (fileSections.length === 0) {
    return testCase.prompt;
  }

  return `${testCase.prompt}\n\n## Files\n\n${fileSections.join("\n\n")}`;
}

// --- Structured script grader output parsing ---

interface StructuredGraderOutput {
  score: number;
  details?: string;
  checks?: Array<{ name: string; passed: boolean; details?: string }>;
}

function parseScriptGraderOutput(stdout: string): { score: number; details: string; checks?: GraderCheck[] } {
  const trimmed = stdout.trim();

  // Try structured JSON first
  try {
    const parsed = JSON.parse(trimmed) as StructuredGraderOutput;
    if (typeof parsed.score === "number" && parsed.score >= 0 && parsed.score <= 1) {
      const checks: GraderCheck[] | undefined = Array.isArray(parsed.checks)
        ? parsed.checks.map((c) => ({ name: c.name, passed: c.passed, details: c.details }))
        : undefined;

      const details = parsed.details
        ?? (checks ? checks.map((c) => `${c.passed ? "PASS" : "FAIL"}: ${c.name}${c.details ? ` — ${c.details}` : ""}`).join("; ") : "Script passed");

      return { score: parsed.score, details, checks };
    }
  } catch {
    // Not JSON, fall through to bare float
  }

  // Fall back to bare float
  const parsedScore = parseFloat(trimmed);
  const score = !isNaN(parsedScore) && parsedScore >= 0 && parsedScore <= 1 ? parsedScore : 1.0;
  return { score, details: trimmed || "Script passed" };
}

// --- Legacy grading (unchanged) ---

interface Judgment {
  passed: boolean;
  score?: number;
  reasoning: string;
  tokens_used: number;
  latency_ms: number;
}

async function judgeResponse(
  testCase: EvalTestCase,
  response: string,
  provider: LLMProvider,
): Promise<Judgment> {
  let expectationsBlock = "";
  if (testCase.expectations && testCase.expectations.length > 0) {
    const checkpoints = testCase.expectations
      .map((e, i) => `  ${i + 1}. ${e}`)
      .join("\n");
    expectationsBlock = `\nExpectations (each must be verified):\n${checkpoints}\n`;
  }

  const judgePrompt = `You are an impartial judge evaluating an AI assistant's response.

Test case: ${testCase.name}
User prompt: ${testCase.prompt}
Expected behavior: ${testCase.expected}
${expectationsBlock}
Actual response:
${response}

Evaluate whether the response meets the expected behavior.${testCase.expectations?.length ? " Verify each expectation individually. The response must satisfy ALL expectations to pass." : ""}

Respond in JSON:
{ "passed": true/false, "score": 0.0 to 1.0, "reasoning": "brief explanation" }

Only return JSON.`;

  const judgeResponse = await provider.complete([
    { role: "system", content: "You are an impartial judge. Always respond with valid JSON only. No markdown formatting, no explanation, no code fences." },
    { role: "user", content: judgePrompt },
  ]);

  if (judgeResponse.isErr()) {
    core.warning(`  Judge for "${testCase.name}" failed: ${judgeResponse.error.message}`);
    return { passed: false, reasoning: `Judge failed: ${judgeResponse.error.message}`, tokens_used: 0, latency_ms: 0 };
  }

  const raw = judgeResponse.value;

  const parsed = Result.try({
    try: () => extractJSON<{ passed: boolean; score: number; reasoning: string }>(raw.content),
    catch: () => new ProviderParseError({ message: "Failed to parse judge response", raw: raw.content }),
  });

  if (parsed.isErr()) {
    return { passed: false, reasoning: "Failed to parse judge response", tokens_used: raw.usage.total_tokens, latency_ms: raw.latency_ms };
  }

  return {
    passed: parsed.value.passed,
    score: parsed.value.score,
    reasoning: parsed.value.reasoning,
    tokens_used: raw.usage.total_tokens,
    latency_ms: raw.latency_ms,
  };
}

function checkHardConstraints(
  testCase: EvalTestCase,
  response: string,
): { passed: boolean; score?: number; reasoning: string } | null {
  const responseLower = response.toLowerCase();

  if (testCase.match_pattern) {
    if (!new RegExp(testCase.match_pattern, "is").test(response)) {
      return { passed: false, score: 0, reasoning: `Response does not match pattern: ${testCase.match_pattern}` };
    }
  }

  if (testCase.required_keywords?.length) {
    const missing = testCase.required_keywords.filter((kw) => !responseLower.includes(kw.toLowerCase()));
    if (missing.length > 0) {
      return { passed: false, score: 0, reasoning: `Missing required keywords: ${missing.join(", ")}` };
    }
  }

  if (testCase.forbidden_keywords?.length) {
    const found = testCase.forbidden_keywords.filter((kw) => responseLower.includes(kw.toLowerCase()));
    if (found.length > 0) {
      return { passed: false, score: 0, reasoning: `Contains forbidden keywords: ${found.join(", ")}` };
    }
  }

  return null;
}
