import * as core from "@actions/core";
import { Result } from "better-result";
import { ProviderParseError } from "../errors.js";
import type { LLMProvider } from "../providers/types.js";
import type { EvalFile, EvalResult, EvalTestCase, Skill } from "../skills/types.js";

export async function runEvals(
  skill: Skill,
  evalFile: EvalFile,
  provider: LLMProvider,
  parallelLimit = 3,
): Promise<EvalResult[]> {
  const results: EvalResult[] = [];

  for (let i = 0; i < evalFile.tests.length; i += parallelLimit) {
    const chunk = evalFile.tests.slice(i, i + parallelLimit);
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

  const systemPrompt = `You are an AI assistant with the following skill activated:

Title: ${skill.metadata.title}
${skill.metadata.description ? `Description: ${skill.metadata.description}` : ""}

Instructions:
${skill.instructions}

Follow the skill instructions precisely when responding.`;

  // Step 1: Get the skill's response
  const skillResponse = await provider.complete([
    { role: "system", content: systemPrompt },
    { role: "user", content: testCase.prompt },
  ]);

  if (skillResponse.isErr()) {
    core.warning(`  Eval "${testCase.name}" provider error: ${skillResponse.error.message}`);
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

  // Step 2: Check hard constraints first (no LLM needed)
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
  const judgePrompt = `You are an impartial judge evaluating an AI assistant's response.

Test case: ${testCase.name}
User prompt: ${testCase.prompt}
Expected behavior: ${testCase.expected}

Actual response:
${response}

Evaluate whether the response meets the expected behavior.

Respond in JSON:
{ "passed": true/false, "score": 0.0 to 1.0, "reasoning": "brief explanation" }

Only return JSON.`;

  const judgeResponse = await provider.complete([{ role: "user", content: judgePrompt }]);

  if (judgeResponse.isErr()) {
    core.warning(`  Judge for "${testCase.name}" failed: ${judgeResponse.error.message}`);
    return { passed: false, reasoning: `Judge failed: ${judgeResponse.error.message}`, tokens_used: 0, latency_ms: 0 };
  }

  const raw = judgeResponse.value;

  const parsed = Result.try({
    try: () => JSON.parse(raw.content) as { passed: boolean; score: number; reasoning: string },
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
