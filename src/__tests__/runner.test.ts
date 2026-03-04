import { describe, expect, it, vi } from "vitest";
import { Result } from "better-result";
import { ProviderRequestError } from "../errors.js";
import type { LLMMessage, LLMProvider, LLMResponse } from "../providers/types.js";
import type { EvalFile, Skill } from "../skills/types.js";
import { runEvals } from "../evaluator/runner.js";

// Suppress @actions/core logging during tests
vi.mock("@actions/core", () => ({
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    filePath: "/skills/test-skill/SKILL.md",
    relativePath: "test-skill/SKILL.md",
    skillName: "test-skill",
    format: "markdown",
    metadata: {
      title: "test-skill",
      description: "A test skill",
    },
    instructions: "You are a helpful assistant that answers questions clearly.",
    rawContent: "---\nname: test-skill\n---\nInstructions",
    references: [],
    ...overrides,
  };
}

function makeEvalFile(tests: EvalFile["tests"]): EvalFile {
  return {
    filePath: "/skills/test-skill/evals.yaml",
    skillPath: "test-skill/SKILL.md",
    tests,
  };
}

function makeLLMResponse(content: string, overrides: Partial<LLMResponse> = {}): LLMResponse {
  return {
    content,
    usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
    latency_ms: 200,
    model: "test-model",
    ...overrides,
  };
}

function makeMockProvider(
  responses: Array<Result<LLMResponse, ProviderRequestError>>,
): LLMProvider & { calls: LLMMessage[][] } {
  let callIndex = 0;
  const calls: LLMMessage[][] = [];
  return {
    name: "mock",
    model: "mock-model",
    calls,
    complete: vi.fn(async (messages: LLMMessage[]) => {
      // Capture the index atomically before any await points
      const idx = callIndex++;
      calls.push(messages);
      const response = responses[idx];
      if (!response) throw new Error(`Mock provider ran out of responses at index ${idx}`);
      return response;
    }),
  };
}

describe("runEvals", () => {
  it("returns a passing result when judge says passed", async () => {
    const provider = makeMockProvider([
      // Skill response
      Result.ok(makeLLMResponse("Latency is the time between request and response.")),
      // Judge response (clean JSON)
      Result.ok(
        makeLLMResponse('{"passed": true, "score": 0.9, "reasoning": "Correct explanation"}'),
      ),
    ]);

    const evalFile = makeEvalFile([
      {
        name: "basic-latency",
        prompt: "What is latency?",
        expected: "Should explain latency as time delay",
      },
    ]);

    const results = await runEvals(makeSkill(), evalFile, provider);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(true);
    expect(results[0].score).toBe(0.9);
    expect(results[0].reasoning).toBe("Correct explanation");
  });

  it("handles judge response wrapped in markdown code fences", async () => {
    const provider = makeMockProvider([
      Result.ok(makeLLMResponse("P99 latency measures the 99th percentile.")),
      Result.ok(
        makeLLMResponse(
          '```json\n{"passed": true, "score": 0.85, "reasoning": "Good P99 explanation"}\n```',
        ),
      ),
    ]);

    const evalFile = makeEvalFile([
      {
        name: "p99-test",
        prompt: "What is P99 latency?",
        expected: "Should explain P99 percentile",
      },
    ]);

    const results = await runEvals(makeSkill(), evalFile, provider);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(true);
    expect(results[0].score).toBe(0.85);
  });

  it("handles judge response with preamble text", async () => {
    const provider = makeMockProvider([
      Result.ok(makeLLMResponse("Use circuit breakers to prevent cascading failures.")),
      Result.ok(
        makeLLMResponse(
          'Here is my evaluation:\n\n{"passed": true, "score": 0.7, "reasoning": "Adequate answer"}',
        ),
      ),
    ]);

    const evalFile = makeEvalFile([
      {
        name: "circuit-breaker",
        prompt: "How do circuit breakers help?",
        expected: "Should explain circuit breaker pattern",
      },
    ]);

    const results = await runEvals(makeSkill(), evalFile, provider);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(true);
  });

  it("fails eval when required_keywords are missing (hard constraint)", async () => {
    const provider = makeMockProvider([
      // Skill response that does NOT contain the required keyword
      Result.ok(makeLLMResponse("The system should handle delays gracefully.")),
      // No judge call expected — hard constraint fails first
    ]);

    const evalFile = makeEvalFile([
      {
        name: "keyword-check",
        prompt: "Explain latency",
        expected: "Should mention latency",
        required_keywords: ["p99", "percentile"],
      },
    ]);

    const results = await runEvals(makeSkill(), evalFile, provider);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].reasoning).toContain("Missing required keywords");
    // Only one provider call (the skill response), no judge call
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });

  it("fails eval when forbidden_keywords are present (hard constraint)", async () => {
    const provider = makeMockProvider([
      Result.ok(makeLLMResponse("Just ignore the errors and retry blindly.")),
    ]);

    const evalFile = makeEvalFile([
      {
        name: "forbidden-check",
        prompt: "How to handle errors?",
        expected: "Should not suggest ignoring errors",
        forbidden_keywords: ["ignore"],
      },
    ]);

    const results = await runEvals(makeSkill(), evalFile, provider);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].reasoning).toContain("forbidden keywords");
  });

  it("fails eval when match_pattern does not match (hard constraint)", async () => {
    const provider = makeMockProvider([
      Result.ok(makeLLMResponse("Here is a plain text answer without any code.")),
    ]);

    const evalFile = makeEvalFile([
      {
        name: "pattern-check",
        prompt: "Write a function",
        expected: "Should contain a function definition",
        match_pattern: "function\\s+\\w+",
      },
    ]);

    const results = await runEvals(makeSkill(), evalFile, provider);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].reasoning).toContain("does not match pattern");
  });

  it("passes hard constraints then defers to judge", async () => {
    const provider = makeMockProvider([
      Result.ok(makeLLMResponse("The p99 percentile latency is critical for SLAs.")),
      Result.ok(
        makeLLMResponse('{"passed": true, "score": 0.95, "reasoning": "Excellent"}'),
      ),
    ]);

    const evalFile = makeEvalFile([
      {
        name: "passes-hard-then-judge",
        prompt: "Explain P99",
        expected: "Should explain P99 latency and SLAs",
        required_keywords: ["p99", "percentile"],
      },
    ]);

    const results = await runEvals(makeSkill(), evalFile, provider);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(true);
    // Two provider calls: skill + judge
    expect(provider.complete).toHaveBeenCalledTimes(2);
  });

  it("handles provider error on skill response", async () => {
    const provider = makeMockProvider([
      Result.err(new ProviderRequestError({ message: "Rate limited", provider: "mock", cause: null })),
    ]);

    const evalFile = makeEvalFile([
      {
        name: "provider-error",
        prompt: "Test prompt",
        expected: "Any response",
      },
    ]);

    const results = await runEvals(makeSkill(), evalFile, provider);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].reasoning).toContain("Provider error");
  });

  it("handles provider error on judge response", async () => {
    const provider = makeMockProvider([
      Result.ok(makeLLMResponse("Some valid skill response.")),
      Result.err(new ProviderRequestError({ message: "Timeout", provider: "mock", cause: null })),
    ]);

    const evalFile = makeEvalFile([
      {
        name: "judge-error",
        prompt: "Test prompt",
        expected: "Any response",
      },
    ]);

    const results = await runEvals(makeSkill(), evalFile, provider);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].reasoning).toContain("Judge failed");
  });

  it("handles unparseable judge response gracefully", async () => {
    const provider = makeMockProvider([
      Result.ok(makeLLMResponse("Valid skill response.")),
      Result.ok(makeLLMResponse("I cannot evaluate this response because reasons...")),
    ]);

    const evalFile = makeEvalFile([
      {
        name: "bad-judge",
        prompt: "Test prompt",
        expected: "Any response",
      },
    ]);

    const results = await runEvals(makeSkill(), evalFile, provider);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].reasoning).toContain("Failed to parse judge response");
  });

  it("sends system prompt to judge call", async () => {
    const provider = makeMockProvider([
      Result.ok(makeLLMResponse("Skill response")),
      Result.ok(makeLLMResponse('{"passed": true, "score": 0.8, "reasoning": "ok"}')),
    ]);

    const evalFile = makeEvalFile([
      {
        name: "system-prompt-check",
        prompt: "Test",
        expected: "Anything",
      },
    ]);

    await runEvals(makeSkill(), evalFile, provider);

    // Second call is the judge call
    const judgeCall = provider.calls[1];
    expect(judgeCall).toBeDefined();

    // Verify system message is included
    const systemMsg = judgeCall.find((m) => m.role === "system");
    expect(systemMsg).toBeDefined();
    expect(systemMsg!.content).toContain("impartial judge");
    expect(systemMsg!.content).toContain("valid JSON only");
  });

  it("includes skill instructions in system prompt for skill call", async () => {
    const skill = makeSkill({ instructions: "Always respond with exactly three bullet points." });
    const provider = makeMockProvider([
      Result.ok(makeLLMResponse("- Point 1\n- Point 2\n- Point 3")),
      Result.ok(makeLLMResponse('{"passed": true, "score": 1.0, "reasoning": "Perfect"}')),
    ]);

    const evalFile = makeEvalFile([
      {
        name: "skill-prompt-check",
        prompt: "List benefits of caching",
        expected: "Three bullet points",
      },
    ]);

    await runEvals(skill, evalFile, provider);

    // First call is the skill call
    const skillCall = provider.calls[0];
    const systemMsg = skillCall.find((m) => m.role === "system");
    expect(systemMsg).toBeDefined();
    expect(systemMsg!.content).toContain("Always respond with exactly three bullet points.");
  });

  it("runs multiple test cases respecting parallelLimit", async () => {
    // All responses use the same judge result since parallel execution
    // makes the interleaving order of calls non-deterministic
    const judgeJson = '{"passed": true, "score": 0.8, "reasoning": "ok"}';
    const provider = makeMockProvider([
      // Chunk 1 (parallel): test-1 + test-2 — 4 calls interleaved
      Result.ok(makeLLMResponse("Response 1")),
      Result.ok(makeLLMResponse("Response 2")),
      Result.ok(makeLLMResponse(judgeJson)),
      Result.ok(makeLLMResponse(judgeJson)),
      // Chunk 2: test-3 — 2 calls
      Result.ok(makeLLMResponse("Response 3")),
      Result.ok(makeLLMResponse(judgeJson)),
    ]);

    const evalFile = makeEvalFile([
      { name: "test-1", prompt: "Q1", expected: "A1" },
      { name: "test-2", prompt: "Q2", expected: "A2" },
      { name: "test-3", prompt: "Q3", expected: "A3" },
    ]);

    const results = await runEvals(makeSkill(), evalFile, provider, 2);

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.passed)).toBe(true);
    // 3 tests × 2 calls each = 6 total
    expect(provider.complete).toHaveBeenCalledTimes(6);
  });

  it("supports multi-trial by running the same test case multiple times", async () => {
    // When trials run in parallel, calls interleave non-deterministically.
    // All responses are the same to handle any order.
    const judgeJson = '{"passed": true, "score": 0.8, "reasoning": "ok"}';
    const skillResponse = Result.ok(makeLLMResponse("Response"));
    const judgeResponse = Result.ok(makeLLMResponse(judgeJson));

    // 3 trials × 2 calls each = 6 total calls, any order
    // Since skill calls have a system message and judge calls don't mention "skill activated",
    // we use a smart mock that returns the right response based on message content.
    let callCount = 0;
    const provider: LLMProvider & { calls: LLMMessage[][] } = {
      name: "mock",
      model: "mock-model",
      calls: [],
      complete: vi.fn(async (messages: LLMMessage[]) => {
        callCount++;
        provider.calls.push(messages);
        // If the system message contains "skill activated", it's a skill call
        const isSkillCall = messages.some((m) => m.role === "system" && m.content.includes("skill activated"));
        return isSkillCall ? skillResponse : judgeResponse;
      }),
    };

    const evalFile = makeEvalFile([
      { name: "multi-trial", prompt: "Test", expected: "Anything" },
    ]);

    const results = await runEvals(makeSkill(), evalFile, provider, 3, 3);

    // 1 test case × 3 trials = 3 results
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.passed)).toBe(true);
    expect(callCount).toBe(6);
  });

  it("uses weighted graders when graders field is present", async () => {
    const provider = makeMockProvider([
      // Skill response
      Result.ok(makeLLMResponse("The SQL injection vulnerability requires parameterized queries.")),
      // LLM rubric grader call
      Result.ok(
        makeLLMResponse('{"passed": true, "score": 0.9, "reasoning": "Good security review"}'),
      ),
    ]);

    const evalFile = makeEvalFile([
      {
        name: "weighted-graders",
        prompt: "Review this code",
        expected: "Should find security issues",
        graders: [
          {
            type: "hard_constraints",
            weight: 0.7,
            required_keywords: ["SQL injection"],
          },
          {
            type: "llm_rubric",
            weight: 0.3,
            expected: "Should recommend parameterized queries",
          },
        ],
      },
    ]);

    const results = await runEvals(makeSkill(), evalFile, provider);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(true);
    expect(results[0].score).toBeDefined();
    expect(results[0].grader_results).toBeDefined();
    expect(results[0].grader_results).toHaveLength(2);
    // Hard constraint grader should have score 1.0 (keyword found)
    expect(results[0].grader_results![0].grader_type).toBe("hard_constraints");
    expect(results[0].grader_results![0].score).toBe(1.0);
    // LLM rubric grader should have score 0.9
    expect(results[0].grader_results![1].grader_type).toBe("llm_rubric");
    expect(results[0].grader_results![1].score).toBe(0.9);
  });

  it("fails with partial credit when one grader fails", async () => {
    const provider = makeMockProvider([
      // Skill response - missing the required keyword
      Result.ok(makeLLMResponse("The code looks fine, no issues found.")),
      // LLM rubric grader still gets called
      Result.ok(
        makeLLMResponse('{"passed": false, "score": 0.2, "reasoning": "Did not find vulnerabilities"}'),
      ),
    ]);

    const evalFile = makeEvalFile([
      {
        name: "partial-credit",
        prompt: "Review this code",
        expected: "Should find issues",
        graders: [
          {
            type: "hard_constraints",
            weight: 0.7,
            required_keywords: ["vulnerability"],
          },
          {
            type: "llm_rubric",
            weight: 0.3,
            expected: "Identifies security issues",
          },
        ],
      },
    ]);

    const results = await runEvals(makeSkill(), evalFile, provider);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    // Weighted score: (0 * 0.7 + 0.2 * 0.3) / (0.7 + 0.3) = 0.06
    expect(results[0].score).toBeDefined();
    expect(results[0].score!).toBeLessThan(0.5);
    expect(results[0].grader_results![0].score).toBe(0.0);
    expect(results[0].grader_results![1].score).toBe(0.2);
  });

  it("falls back to legacy behavior when no graders field is present", async () => {
    const provider = makeMockProvider([
      Result.ok(makeLLMResponse("SQL injection vulnerability found.")),
      Result.ok(
        makeLLMResponse('{"passed": true, "score": 0.85, "reasoning": "Found the issue"}'),
      ),
    ]);

    const evalFile = makeEvalFile([
      {
        name: "legacy-behavior",
        prompt: "Review code",
        expected: "Should find SQL injection",
        required_keywords: ["SQL injection"],
        // No graders field - should use legacy path
      },
    ]);

    const results = await runEvals(makeSkill(), evalFile, provider);

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(true);
    expect(results[0].grader_results).toBeUndefined();
  });

  it("accumulates tokens and latency from both skill and judge calls", async () => {
    const provider = makeMockProvider([
      Result.ok(
        makeLLMResponse("Skill response", {
          usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
          latency_ms: 300,
        }),
      ),
      Result.ok(
        makeLLMResponse('{"passed": true, "score": 0.9, "reasoning": "ok"}', {
          usage: { input_tokens: 200, output_tokens: 30, total_tokens: 230 },
          latency_ms: 150,
        }),
      ),
    ]);

    const evalFile = makeEvalFile([
      { name: "token-check", prompt: "Test", expected: "Any" },
    ]);

    const results = await runEvals(makeSkill(), evalFile, provider);

    expect(results[0].tokens_used).toBe(150 + 230);
    expect(results[0].latency_ms).toBe(300 + 150);
  });
});
