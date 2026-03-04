import { describe, expect, it } from "vitest";
import { extractJSON } from "../utils/json.js";

describe("extractJSON", () => {
  it("parses clean JSON", () => {
    const result = extractJSON<{ passed: boolean }>(
      '{"passed": true, "score": 0.9, "reasoning": "Good response"}',
    );
    expect(result.passed).toBe(true);
  });

  it("strips markdown code fences with json tag", () => {
    const input = '```json\n{"passed": true, "score": 0.8, "reasoning": "ok"}\n```';
    const result = extractJSON<{ passed: boolean; score: number }>(input);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(0.8);
  });

  it("strips markdown code fences without json tag", () => {
    const input = '```\n{"passed": false, "reasoning": "bad"}\n```';
    const result = extractJSON<{ passed: boolean }>(input);
    expect(result.passed).toBe(false);
  });

  it("extracts JSON from preamble text", () => {
    const input =
      'Here is my evaluation:\n\n{"passed": true, "score": 1.0, "reasoning": "Excellent"}';
    const result = extractJSON<{ passed: boolean; score: number }>(input);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it("extracts JSON with trailing text", () => {
    const input =
      '{"passed": false, "score": 0.2, "reasoning": "Poor"}\n\nLet me know if you need more details.';
    const result = extractJSON<{ passed: boolean }>(input);
    expect(result.passed).toBe(false);
  });

  it("extracts JSON with both preamble and trailing text", () => {
    const input =
      'Based on my analysis:\n{"passed": true, "score": 0.7, "reasoning": "Adequate"}\nHope this helps!';
    const result = extractJSON<{ passed: boolean; score: number }>(input);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(0.7);
  });

  it("handles nested objects correctly", () => {
    const input =
      '{"passed": true, "details": {"keywords_found": ["latency", "p99"]}, "reasoning": "ok"}';
    const result = extractJSON<{ passed: boolean; details: { keywords_found: string[] } }>(input);
    expect(result.passed).toBe(true);
    expect(result.details.keywords_found).toEqual(["latency", "p99"]);
  });

  it("handles escaped quotes in strings", () => {
    const input = '{"passed": true, "reasoning": "The response said \\"hello world\\""}';
    const result = extractJSON<{ passed: boolean; reasoning: string }>(input);
    expect(result.passed).toBe(true);
    expect(result.reasoning).toBe('The response said "hello world"');
  });

  it("handles braces inside string values", () => {
    const input = '{"passed": true, "reasoning": "Output contains {braces} inside"}';
    const result = extractJSON<{ passed: boolean; reasoning: string }>(input);
    expect(result.passed).toBe(true);
    expect(result.reasoning).toBe("Output contains {braces} inside");
  });

  it("handles code fences with extra whitespace", () => {
    const input = '```json  \n  {"passed": true, "score": 0.5}  \n  ```';
    const result = extractJSON<{ passed: boolean; score: number }>(input);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(0.5);
  });

  it("prioritizes code fence extraction over brace extraction", () => {
    // If there's a code fence, it should use that rather than scanning for braces
    const input =
      'Preamble with {invalid json\n```json\n{"passed": true, "score": 1.0}\n```\nTrailing text';
    const result = extractJSON<{ passed: boolean }>(input);
    expect(result.passed).toBe(true);
  });

  it("throws on empty string", () => {
    expect(() => extractJSON("")).toThrow();
  });

  it("throws on non-JSON text", () => {
    expect(() => extractJSON("This is just plain text with no JSON at all.")).toThrow();
  });

  it("throws on malformed JSON", () => {
    expect(() => extractJSON('{"passed": true, "score": }')).toThrow();
  });

  it("handles whitespace-padded input", () => {
    const input = '   \n  {"passed": true, "reasoning": "ok"}  \n   ';
    const result = extractJSON<{ passed: boolean }>(input);
    expect(result.passed).toBe(true);
  });

  it("handles the real-world judge response pattern", () => {
    // This is the actual pattern that caused the failures:
    // LLM returns markdown-wrapped JSON in a judge response
    const input = `Here is my evaluation of the response:

\`\`\`json
{
  "passed": true,
  "score": 0.85,
  "reasoning": "The response correctly identifies key latency engineering concepts including P99 tail latency, load shedding, and circuit breakers."
}
\`\`\`

I hope this evaluation is helpful.`;
    const result = extractJSON<{ passed: boolean; score: number; reasoning: string }>(input);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(0.85);
    expect(result.reasoning).toContain("P99 tail latency");
  });
});
