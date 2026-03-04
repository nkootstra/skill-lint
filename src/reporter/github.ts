import * as github from "@actions/github";
import { Result } from "better-result";
import { ReporterError } from "../errors.js";
import type { SkillEvaluationResult } from "../skills/types.js";
import { redactSecrets } from "../utils/sanitize.js";
import { formatComment } from "./comment.js";
import { createCheckRun } from "./check.js";

type Octokit = ReturnType<typeof github.getOctokit>;

export interface ReporterOptions {
  token: string;
  owner: string;
  repo: string;
  prNumber: number;
  sha: string;
  failOn: "error" | "warning" | "never";
  /** Secret values to redact from PR comments and check run output */
  secrets?: string[];
}

export class GitHubReporter {
  private octokit: Octokit;
  private options: ReporterOptions;

  constructor(options: ReporterOptions) {
    this.options = options;
    this.octokit = github.getOctokit(options.token);
  }

  async report(results: SkillEvaluationResult[]): Promise<Result<
    { passed: boolean; commentUrl: string; checkUrl: string },
    ReporterError
  >> {
    const passed = this.determinePassFail(results);

    return Result.tryPromise({
      try: async () => {
        const [commentUrl, checkUrl] = await Promise.all([
          this.postComment(results, passed),
          createCheckRun(this.octokit as any, {
            owner: this.options.owner,
            repo: this.options.repo,
            sha: this.options.sha,
            results,
            passed,
          }),
        ]);
        return { passed, commentUrl, checkUrl };
      },
      catch: (cause) =>
        new ReporterError({
          message: `Failed to report results: ${cause instanceof Error ? cause.message : String(cause)}`,
          cause,
        }),
    });
  }

  private determinePassFail(results: SkillEvaluationResult[]): boolean {
    if (this.options.failOn === "never") return true;

    for (const result of results) {
      if (result.lint_issues.some((i) => i.severity === "error")) return false;
      if (result.eval_results.some((r) => !r.passed)) return false;
      if (this.options.failOn === "warning" && result.lint_issues.some((i) => i.severity === "warning")) return false;
    }

    return true;
  }

  private async postComment(results: SkillEvaluationResult[], passed: boolean): Promise<string> {
    const rawBody = formatComment(results, passed);
    const body = this.options.secrets?.length
      ? redactSecrets(rawBody, this.options.secrets)
      : rawBody;

    const { data: comments } = await this.octokit.rest.issues.listComments({
      owner: this.options.owner,
      repo: this.options.repo,
      issue_number: this.options.prNumber,
    });

    const existing = comments.find(
      (c) => c.body?.includes("<!-- skill-lint-report -->") && c.user?.login === "github-actions[bot]",
    );

    if (existing) {
      const { data } = await this.octokit.rest.issues.updateComment({
        owner: this.options.owner,
        repo: this.options.repo,
        comment_id: existing.id,
        body,
      });
      return data.html_url;
    }

    const { data } = await this.octokit.rest.issues.createComment({
      owner: this.options.owner,
      repo: this.options.repo,
      issue_number: this.options.prNumber,
      body,
    });

    return data.html_url;
  }
}
