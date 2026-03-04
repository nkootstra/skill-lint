import type { SkillEvaluationResult } from "../skills/types.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Octokit = { rest: { checks: { create: (params: any) => Promise<{ data: { html_url: string | null } }> } } };

interface CheckRunOptions {
  owner: string;
  repo: string;
  sha: string;
  results: SkillEvaluationResult[];
  passed: boolean;
}

export async function createCheckRun(
  octokit: Octokit,
  options: CheckRunOptions,
): Promise<string> {
  const { owner, repo, sha, results, passed } = options;

  const totalEvals = results.reduce(
    (sum, r) => sum + r.eval_results.length,
    0,
  );
  const passedEvals = results.reduce(
    (sum, r) => sum + r.eval_results.filter((e) => e.passed).length,
    0,
  );
  const totalIssues = results.reduce(
    (sum, r) => sum + r.lint_issues.filter((i) => i.severity === "error").length,
    0,
  );

  const summary = buildCheckSummary(results, passed);

  const annotations = results.flatMap((result) =>
    result.lint_issues
      .filter((issue) => issue.severity === "error" || issue.severity === "warning")
      .map((issue) => ({
        path: result.skill.relativePath,
        start_line: issue.line ?? 1,
        end_line: issue.line ?? 1,
        annotation_level: issue.severity === "error"
          ? ("failure" as const)
          : ("warning" as const),
        message: issue.message,
        title: issue.rule,
        raw_details: issue.suggestion ?? undefined,
      })),
  );

  const { data } = await octokit.rest.checks.create({
    owner,
    repo,
    name: "Skill Lint",
    head_sha: sha,
    status: "completed",
    conclusion: passed ? "success" : "failure",
    output: {
      title: passed
        ? `All checks passed (${passedEvals}/${totalEvals} evals)`
        : `${totalIssues} error(s), ${totalEvals - passedEvals} failed eval(s)`,
      summary,
      annotations: annotations.slice(0, 50), // GitHub limits to 50
    },
  });

  return data.html_url ?? "";
}

function buildCheckSummary(
  results: SkillEvaluationResult[],
  passed: boolean,
): string {
  const lines: string[] = [];

  for (const result of results) {
    const errors = result.lint_issues.filter((i) => i.severity === "error").length;
    const warnings = result.lint_issues.filter((i) => i.severity === "warning").length;
    const evalsPassed = result.eval_results.filter((r) => r.passed).length;
    const evalsTotal = result.eval_results.length;

    lines.push(
      `**${result.skill.metadata.title}**: ${errors} errors, ${warnings} warnings, ${evalsPassed}/${evalsTotal} evals passed`,
    );
  }

  return lines.join("\n");
}
