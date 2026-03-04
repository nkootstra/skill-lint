import * as core from "@actions/core";
import type { LLMProvider } from "../providers/types.js";
import type { EvalFile, EvalResult, EvalTestCase, Skill } from "../skills/types.js";

export async function runEvals(
  skill: Skill,
  evalFile: EvalFile,
  provider: LLMProvider,
  parallelLimit = 3,
): Promise<EvalResult[]> {
  const results: EvalResult[] = [];

  // Run test cases with concurrency limit
  const chunks = chunkArray(evalFile.tests, parallelLimit);

  for (const chunk of chunks) {
    const chunkResults = await Promise.all(
      chunk.map((testCase) => runSingleEval(skill, testCase, provider)),
    );
    results.push(...chunkResults);
  }

  return results;
}

async function runSingleEval(
  skill: Skill,
  testCase: EvalTestCase,
  provider: LLMProvider,
): Promise<EvalResult> {
  core.info(`  Running eval: ${testCase.name}`);

  const systemPrompt = buildSkillSystemPrompt(skill);
  const evaluationPrompt = buildEvaluationPrompt(testCase);

  try {
    // Step 1: Get the skill's response to the test prompt
    const skillResponse = await provider.complete([
      { role: "system", content: systemPrompt },
      { role: "user", content: testCase.prompt },
    ]);

    // Step 2: Evaluate the response against expectations
    const evaluation = await evaluateResponse(
      testCase,
      skillResponse.content,
      provider,
    );

    return {
      testCase,
      passed: evaluation.passed,
      output: skillResponse.content,
      score: evaluation.score,
      reasoning: evaluation.reasoning,
      tokens_used:
        skillResponse.usage.total_tokens + evaluation.tokens_used,
      latency_ms: skillResponse.latency_ms + evaluation.latency_ms,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      testCase,
      passed: false,
      output: "",
      reasoning: `Eval failed with error: ${message}`,
      tokens_used: 0,
      latency_ms: 0,
    };
  }
}

function buildSkillSystemPrompt(skill: Skill): string {
  return `You are an AI assistant with the following skill activated:

Title: ${skill.metadata.title}
${skill.metadata.description ? `Description: ${skill.metadata.description}` : ""}

Instructions:
${skill.instructions}

Follow the skill instructions precisely when responding.`;
}

function buildEvaluationPrompt(testCase: EvalTestCase): string {
  const parts = [`Test case: ${testCase.name}`, `Prompt: ${testCase.prompt}`];

  if (testCase.expected) {
    parts.push(`Expected: ${testCase.expected}`);
  }

  return parts.join("\n");
}

interface EvalJudgment {
  passed: boolean;
  score?: number;
  reasoning: string;
  tokens_used: number;
  latency_ms: number;
}

async function evaluateResponse(
  testCase: EvalTestCase,
  response: string,
  provider: LLMProvider,
): Promise<EvalJudgment> {
  // Check hard constraints first (no LLM needed)
  const hardCheckResult = checkHardConstraints(testCase, response);
  if (hardCheckResult !== null) {
    return {
      ...hardCheckResult,
      tokens_used: 0,
      latency_ms: 0,
    };
  }

  // Use LLM as judge for semantic evaluation
  const judgePrompt = `You are an impartial judge evaluating an AI assistant's response.

Test case: ${testCase.name}
User prompt: ${testCase.prompt}
Expected behavior: ${testCase.expected}

Actual response:
${response}

Evaluate whether the response meets the expected behavior. Consider:
1. Does the response address the prompt correctly?
2. Does it match the expected behavior?
3. Is the response quality acceptable?

Respond in JSON:
{
  "passed": true/false,
  "score": 0.0 to 1.0,
  "reasoning": "brief explanation"
}

Only return JSON.`;

  const start = Date.now();
  const judgment = await provider.complete([
    { role: "user", content: judgePrompt },
  ]);

  try {
    const parsed = JSON.parse(judgment.content) as {
      passed: boolean;
      score: number;
      reasoning: string;
    };
    return {
      passed: parsed.passed,
      score: parsed.score,
      reasoning: parsed.reasoning,
      tokens_used: judgment.usage.total_tokens,
      latency_ms: Date.now() - start,
    };
  } catch {
    return {
      passed: false,
      reasoning: "Failed to parse judge response",
      tokens_used: judgment.usage.total_tokens,
      latency_ms: Date.now() - start,
    };
  }
}

function checkHardConstraints(
  testCase: EvalTestCase,
  response: string,
): { passed: boolean; score?: number; reasoning: string } | null {
  const responseLower = response.toLowerCase();

  // Check regex pattern
  if (testCase.match_pattern) {
    const regex = new RegExp(testCase.match_pattern, "is");
    if (!regex.test(response)) {
      return {
        passed: false,
        score: 0,
        reasoning: `Response does not match required pattern: ${testCase.match_pattern}`,
      };
    }
  }

  // Check required keywords
  if (testCase.required_keywords?.length) {
    const missing = testCase.required_keywords.filter(
      (kw) => !responseLower.includes(kw.toLowerCase()),
    );
    if (missing.length > 0) {
      return {
        passed: false,
        score: 0,
        reasoning: `Response missing required keywords: ${missing.join(", ")}`,
      };
    }
  }

  // Check forbidden keywords
  if (testCase.forbidden_keywords?.length) {
    const found = testCase.forbidden_keywords.filter((kw) =>
      responseLower.includes(kw.toLowerCase()),
    );
    if (found.length > 0) {
      return {
        passed: false,
        score: 0,
        reasoning: `Response contains forbidden keywords: ${found.join(", ")}`,
      };
    }
  }

  // No hard constraint failures - need LLM judge
  return null;
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
