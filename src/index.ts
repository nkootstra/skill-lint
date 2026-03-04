import * as core from "@actions/core";
import * as github from "@actions/github";
import { Result } from "better-result";
import { loadConfig } from "./config/loader.js";
import { runPipeline } from "./evaluator/pipeline.js";
import { createProvider } from "./providers/index.js";
import { GitHubReporter, type ReporterOptions } from "./reporter/github.js";
import { getBaseBranch, getChangedFiles } from "./utils/diff.js";

async function run(): Promise<void> {
  // Load config
  const configPath = core.getInput("config_path") || ".skill-lint.yml";
  const configResult = loadConfig(configPath);

  if (configResult.isErr()) {
    core.setFailed(configResult.error.message);
    return;
  }

  const config = configResult.value;
  core.info(`Provider: ${config.provider.type} | Skills path: ${config.skills_path}`);

  // Create provider
  const providerResult = createProvider(config.provider);

  if (providerResult.isErr()) {
    core.setFailed(providerResult.error.message);
    return;
  }

  const provider = providerResult.value;
  core.info(`Model: ${provider.model}`);

  // Determine base branch and changed files
  const baseBranch = await getBaseBranch();
  const changedFiles = await getChangedFiles(baseBranch);
  core.info(`Base: ${baseBranch} | Changed files: ${changedFiles.length}`);

  if (changedFiles.length === 0) {
    setOutputs(true, [], "No changed files.");
    return;
  }

  // Run pipeline
  const results = await runPipeline({ config, provider, changedFiles, baseBranch });

  if (results.length === 0) {
    setOutputs(true, [], "No skill files in this PR.");
    return;
  }

  // Report
  const context = github.context;
  const isPR = context.payload.pull_request !== undefined;

  if (isPR) {
    const token = core.getInput("github_token") || process.env.GITHUB_TOKEN || "";
    const reporter = new GitHubReporter({
      token,
      owner: context.repo.owner,
      repo: context.repo.repo,
      prNumber: context.payload.pull_request!.number,
      sha: context.payload.pull_request!.head.sha,
      failOn: config.fail_on,
    });

    const reportResult = await reporter.report(results);

    if (reportResult.isOk()) {
      const { passed, commentUrl, checkUrl } = reportResult.value;
      core.info(`PR comment: ${commentUrl}`);
      core.info(`Check run: ${checkUrl}`);
      setOutputs(passed, results);
      if (!passed && core.getInput("fail_on_error") !== "false") {
        core.setFailed("Skill evaluation found issues. See PR comment for details.");
      }
    } else {
      core.warning(`Reporter error: ${reportResult.error.message}`);
      setOutputs(false, results);
    }
  } else {
    const passed = results.every(
      (r) => r.lint_issues.filter((i) => i.severity === "error").length === 0 && r.eval_results.every((e) => e.passed),
    );
    setOutputs(passed, results);
    if (!passed && core.getInput("fail_on_error") !== "false") {
      core.setFailed("Skill evaluation found issues.");
    }
  }

  core.info("Done!");
}

function setOutputs(passed: boolean, results: Array<{ skill: { metadata: { title: string }; relativePath: string }; lint_issues: unknown[]; eval_results: Array<{ passed: boolean }>; suggestions: unknown[] }>, summary?: string) {
  core.setOutput("passed", String(passed));

  const resultsSummary = results.map((r) => ({
    skill: r.skill.metadata.title,
    file: r.skill.relativePath,
    lint_issues: r.lint_issues.length,
    evals_passed: r.eval_results.filter((e) => e.passed).length,
    evals_total: r.eval_results.length,
    suggestions: r.suggestions.length,
  }));

  core.setOutput("results", JSON.stringify(resultsSummary));
  core.setOutput("summary", summary ?? resultsSummary.map(
    (r) => `${r.skill}: ${r.lint_issues} issues, ${r.evals_passed}/${r.evals_total} evals`,
  ).join("; "));
}

run();
