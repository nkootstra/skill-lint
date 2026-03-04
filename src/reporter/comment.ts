import {
  formatBenchmarkTable,
  formatComparisonTable,
} from "../evaluator/benchmarker.js";
import type { SkillEvaluationResult } from "../skills/types.js";

export function formatComment(
  results: SkillEvaluationResult[],
  passed: boolean,
): string {
  const parts: string[] = [
    "<!-- skill-lint-report -->",
    `## Skill Lint Report ${passed ? "- All Checks Passed" : "- Issues Found"}`,
    "",
  ];

  // Summary
  const totalSkills = results.length;
  const totalIssues = results.reduce(
    (sum, r) => sum + r.lint_issues.length,
    0,
  );
  const totalEvals = results.reduce(
    (sum, r) => sum + r.eval_results.length,
    0,
  );
  const passedEvals = results.reduce(
    (sum, r) => sum + r.eval_results.filter((e) => e.passed).length,
    0,
  );
  const totalSuggestions = results.reduce(
    (sum, r) => sum + r.suggestions.length,
    0,
  );

  parts.push(
    `**${totalSkills}** skill(s) evaluated | **${totalIssues}** lint issue(s) | **${passedEvals}/${totalEvals}** eval(s) passed | **${totalSuggestions}** suggestion(s)`,
    "",
  );

  // Per-skill results
  for (const result of results) {
    parts.push(
      `### ${result.skill.metadata.title} (\`${result.skill.relativePath}\`)`,
      "",
    );

    // Lint issues
    if (result.lint_issues.length > 0) {
      parts.push("#### Lint Issues", "");
      for (const issue of result.lint_issues) {
        const icon =
          issue.severity === "error"
            ? "**Error:**"
            : issue.severity === "warning"
              ? "**Warning:**"
              : "**Info:**";
        parts.push(`- ${icon} ${issue.message}`);
        if (issue.suggestion) {
          parts.push(`  - Suggestion: ${issue.suggestion}`);
        }
      }
      parts.push("");
    } else {
      parts.push("**Lint:** No issues found", "");
    }

    // Eval results
    if (result.eval_results.length > 0) {
      parts.push("#### Evaluation Results", "");
      parts.push(
        "| Test | Status | Score | Tokens | Latency |",
        "|------|--------|-------|--------|---------|",
      );

      for (const evalResult of result.eval_results) {
        const status = evalResult.passed ? "Passed" : "Failed";
        const score =
          evalResult.score !== undefined
            ? `${(evalResult.score * 100).toFixed(0)}%`
            : "-";
        parts.push(
          `| ${evalResult.testCase.name} | ${status} | ${score} | ${evalResult.tokens_used} | ${evalResult.latency_ms}ms |`,
        );
      }
      parts.push("");

      // Show reasoning for failed evals
      const failed = result.eval_results.filter((r) => !r.passed);
      if (failed.length > 0) {
        parts.push("<details><summary>Failed eval details</summary>", "");
        for (const f of failed) {
          parts.push(`**${f.testCase.name}**`);
          if (f.reasoning) {
            parts.push(`> ${f.reasoning}`);
          }
          parts.push("");
        }
        parts.push("</details>", "");
      }
    }

    // Suggestions
    if (result.suggestions.length > 0) {
      parts.push("#### Suggestions", "");
      for (const suggestion of result.suggestions) {
        parts.push(`- ${suggestion}`);
      }
      parts.push("");
    }

    parts.push("---", "");
  }

  // Benchmark table
  const benchmarks = results.map((r) => r.benchmark);
  parts.push("### Benchmarks", "", formatBenchmarkTable(benchmarks), "");

  // Comparison table
  const comparisons = results
    .filter((r) => r.comparison !== null)
    .map((r) => ({
      skill: r.comparison!.skill,
      base: r.comparison!.base_benchmark,
      head: r.comparison!.head_benchmark,
      delta: r.comparison!.delta,
    }));

  if (comparisons.length > 0) {
    parts.push(formatComparisonTable(comparisons), "");
  }

  parts.push(
    "",
    "*Powered by [skill-lint](https://github.com/nkootstra/skill-lint)*",
  );

  return parts.join("\n");
}
