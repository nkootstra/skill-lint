import { Result } from "better-result";
import { ProviderParseError } from "../errors.js";
import type { LLMProvider } from "../providers/types.js";
import type { EvalResult, LintIssue, Skill } from "../skills/types.js";
import { extractJSON } from "../utils/json.js";

export async function generateSuggestions(
  skill: Skill,
  lintIssues: LintIssue[],
  evalResults: EvalResult[],
  provider: LLMProvider,
): Promise<string[]> {
  const failedEvals = evalResults.filter((r) => !r.passed);
  const errorIssues = lintIssues.filter((i) => i.severity === "error");
  const warningIssues = lintIssues.filter((i) => i.severity === "warning");

  if (failedEvals.length === 0 && errorIssues.length === 0 && warningIssues.length === 0) {
    return [];
  }

  const prompt = buildSuggestionPrompt(skill, lintIssues, failedEvals);
  const response = await provider.complete([
    { role: "system", content: SUGGESTER_SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ]);

  if (response.isErr()) {
    return generateFallbackSuggestions(lintIssues, failedEvals);
  }

  const parsed = Result.try({
    try: () => extractJSON<{ suggestions: string[] }>(response.value.content),
    catch: () => new ProviderParseError({ message: "Failed to parse suggestions", raw: response.value.content }),
  });

  if (parsed.isOk()) return parsed.value.suggestions ?? [];

  // Fallback: extract from non-JSON response
  const lines = response.value.content
    .split("\n")
    .filter((l) => l.trim().startsWith("-") || l.trim().match(/^\d+\./));
  const extracted = lines.map((l) => l.replace(/^[\s-]*\d*\.?\s*/, "").trim()).filter(Boolean);

  return extracted.length > 0 ? extracted : generateFallbackSuggestions(lintIssues, failedEvals);
}

const SUGGESTER_SYSTEM_PROMPT = `You are a skill quality expert. Analyze agent skill definitions and suggest specific, actionable improvements.

Focus on:
1. Clarity and precision of instructions
2. Trigger accuracy (reducing false positives/negatives)
3. Response quality and consistency
4. Token efficiency

Respond in JSON: { "suggestions": ["suggestion 1", "suggestion 2"] }
Only return JSON.`;

function buildSuggestionPrompt(skill: Skill, lintIssues: LintIssue[], failedEvals: EvalResult[]): string {
  const parts: string[] = [
    `## Skill: ${skill.metadata.title}`,
    `Description: ${skill.metadata.description ?? "N/A"}`,
    "",
    "## Instructions:",
    skill.instructions,
  ];

  if (lintIssues.length > 0) {
    parts.push("", "## Lint Issues:");
    for (const issue of lintIssues) {
      parts.push(`- [${issue.severity}] ${issue.message}`);
    }
  }

  if (failedEvals.length > 0) {
    parts.push("", "## Failed Evaluations:");
    for (const result of failedEvals) {
      parts.push(`- Test: ${result.testCase.name}`, `  Expected: ${result.testCase.expected}`, `  Got: ${result.output.slice(0, 500)}`);
      if (result.reasoning) parts.push(`  Reason: ${result.reasoning}`);
    }
  }

  parts.push("", "Provide specific suggestions to improve this skill.");
  return parts.join("\n");
}

function generateFallbackSuggestions(lintIssues: LintIssue[], failedEvals: EvalResult[]): string[] {
  const suggestions: string[] = [];

  for (const issue of lintIssues) {
    if (issue.suggestion) suggestions.push(issue.suggestion);
  }

  if (failedEvals.length > 0) {
    suggestions.push(`${failedEvals.length} eval(s) failed. Review the skill instructions for clarity and completeness.`);
  }

  return suggestions;
}
