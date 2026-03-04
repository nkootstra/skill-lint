import type { LLMProvider } from "../providers/types.js";
import type { EvalResult, LintIssue, Skill } from "../skills/types.js";

/**
 * Uses the LLM to generate improvement suggestions for a skill
 * based on lint issues and eval results.
 */
export async function generateSuggestions(
  skill: Skill,
  lintIssues: LintIssue[],
  evalResults: EvalResult[],
  provider: LLMProvider,
): Promise<string[]> {
  const failedEvals = evalResults.filter((r) => !r.passed);
  const errorIssues = lintIssues.filter((i) => i.severity === "error");
  const warningIssues = lintIssues.filter((i) => i.severity === "warning");

  // If everything is passing, minimal suggestions
  if (failedEvals.length === 0 && errorIssues.length === 0 && warningIssues.length === 0) {
    return [];
  }

  const prompt = buildSuggestionPrompt(
    skill,
    lintIssues,
    failedEvals,
  );

  try {
    const response = await provider.complete([
      { role: "system", content: SUGGESTER_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ]);

    return parseSuggestions(response.content);
  } catch {
    // Fall back to rule-based suggestions
    return generateFallbackSuggestions(lintIssues, failedEvals);
  }
}

const SUGGESTER_SYSTEM_PROMPT = `You are a skill quality expert. Your job is to analyze agent skill definitions and suggest specific, actionable improvements.

Focus on:
1. Clarity and precision of instructions
2. Trigger accuracy (reducing false positives/negatives)
3. Response quality and consistency
4. Token efficiency

Be specific and concise. Each suggestion should be one clear action item.

Respond in JSON format:
{
  "suggestions": [
    "suggestion 1",
    "suggestion 2"
  ]
}

Only return JSON.`;

function buildSuggestionPrompt(
  skill: Skill,
  lintIssues: LintIssue[],
  failedEvals: EvalResult[],
): string {
  const parts: string[] = [
    `## Skill: ${skill.metadata.title}`,
    `Format: ${skill.format}`,
    `Description: ${skill.metadata.description ?? "N/A"}`,
    "",
    "## Instructions:",
    skill.instructions,
    "",
  ];

  if (lintIssues.length > 0) {
    parts.push("## Lint Issues:");
    for (const issue of lintIssues) {
      parts.push(`- [${issue.severity}] ${issue.message}`);
      if (issue.suggestion) {
        parts.push(`  Suggestion: ${issue.suggestion}`);
      }
    }
    parts.push("");
  }

  if (failedEvals.length > 0) {
    parts.push("## Failed Evaluations:");
    for (const result of failedEvals) {
      parts.push(`- Test: ${result.testCase.name}`);
      parts.push(`  Prompt: ${result.testCase.prompt}`);
      parts.push(`  Expected: ${result.testCase.expected}`);
      parts.push(`  Got: ${result.output.slice(0, 500)}`);
      if (result.reasoning) {
        parts.push(`  Reason: ${result.reasoning}`);
      }
    }
    parts.push("");
  }

  parts.push(
    "Based on the above issues, provide specific suggestions to improve this skill.",
  );

  return parts.join("\n");
}

function parseSuggestions(content: string): string[] {
  try {
    const parsed = JSON.parse(content) as { suggestions: string[] };
    return parsed.suggestions ?? [];
  } catch {
    // Try to extract suggestions from non-JSON response
    const lines = content.split("\n").filter((l) => l.trim().startsWith("-") || l.trim().match(/^\d+\./));
    return lines.map((l) => l.replace(/^[\s-]*\d*\.?\s*/, "").trim()).filter(Boolean);
  }
}

function generateFallbackSuggestions(
  lintIssues: LintIssue[],
  failedEvals: EvalResult[],
): string[] {
  const suggestions: string[] = [];

  for (const issue of lintIssues) {
    if (issue.suggestion) {
      suggestions.push(issue.suggestion);
    }
  }

  if (failedEvals.length > 0) {
    const failRate = failedEvals.length;
    suggestions.push(
      `${failRate} eval(s) failed. Review the skill instructions for clarity and completeness.`,
    );

    const hasKeywordFailures = failedEvals.some(
      (r) => r.reasoning?.includes("keyword"),
    );
    if (hasKeywordFailures) {
      suggestions.push(
        "Some evals failed keyword checks. Ensure the skill instructions guide the model to use expected terminology.",
      );
    }
  }

  return suggestions;
}
