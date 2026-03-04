import * as github from "@actions/github";
import type { SkillEvaluationResult } from "../skills/types.js";
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
}

export class GitHubReporter {
  private octokit: Octokit;
  private options: ReporterOptions;

  constructor(options: ReporterOptions) {
    this.options = options;
    this.octokit = github.getOctokit(options.token);
  }

  async report(results: SkillEvaluationResult[]): Promise<{
    passed: boolean;
    commentUrl: string;
    checkUrl: string;
  }> {
    const passed = this.determinePassFail(results);

    // Post PR comment and create check run in parallel
    const [commentUrl, checkUrl] = await Promise.all([
      this.postComment(results, passed),
      this.createCheck(results, passed),
    ]);

    return { passed, commentUrl, checkUrl };
  }

  private determinePassFail(results: SkillEvaluationResult[]): boolean {
    if (this.options.failOn === "never") return true;

    for (const result of results) {
      const hasErrors = result.lint_issues.some(
        (i) => i.severity === "error",
      );
      const hasWarnings = result.lint_issues.some(
        (i) => i.severity === "warning",
      );
      const hasFailedEvals = result.eval_results.some((r) => !r.passed);

      if (hasErrors || hasFailedEvals) return false;
      if (this.options.failOn === "warning" && hasWarnings) return false;
    }

    return true;
  }

  private async postComment(
    results: SkillEvaluationResult[],
    passed: boolean,
  ): Promise<string> {
    const body = formatComment(results, passed);

    // Look for existing skill-lint comment to update
    const { data: comments } = await this.octokit.rest.issues.listComments({
      owner: this.options.owner,
      repo: this.options.repo,
      issue_number: this.options.prNumber,
    });

    const existing = comments.find(
      (c) =>
        c.body?.includes("<!-- skill-lint-report -->") &&
        c.user?.login === "github-actions[bot]",
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

  private async createCheck(
    results: SkillEvaluationResult[],
    passed: boolean,
  ): Promise<string> {
    return createCheckRun(this.octokit, {
      owner: this.options.owner,
      repo: this.options.repo,
      sha: this.options.sha,
      results,
      passed,
    });
  }
}
