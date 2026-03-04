import * as core from "@actions/core";
import * as github from "@actions/github";
import { loadConfig } from "./config/loader.js";
import { runPipeline } from "./evaluator/pipeline.js";
import { createProvider } from "./providers/index.js";
import { GitHubReporter, type ReporterOptions } from "./reporter/github.js";
import { getBaseBranch, getChangedFiles } from "./utils/diff.js";

async function run(): Promise<void> {
  try {
    // Load configuration
    const configPath = core.getInput("config_path") || ".skill-lint.yml";
    const config = loadConfig(configPath);
    core.info(`Provider: ${config.provider.type}`);
    core.info(`Skills path: ${config.skills_path}`);

    // Create LLM provider
    const provider = createProvider(config.provider);
    core.info(`Using model: ${provider.model}`);

    // Determine base branch and changed files
    const baseBranch = await getBaseBranch();
    core.info(`Base branch: ${baseBranch}`);

    const changedFiles = await getChangedFiles(baseBranch);
    core.info(`Changed files: ${changedFiles.length}`);

    if (changedFiles.length === 0) {
      core.info("No changed files detected. Exiting.");
      core.setOutput("passed", "true");
      core.setOutput("results", "[]");
      core.setOutput("summary", "No skill files changed.");
      return;
    }

    // Run the evaluation pipeline
    const results = await runPipeline({
      config,
      provider,
      changedFiles,
      baseBranch,
    });

    if (results.length === 0) {
      core.info("No skills found in changed files. Exiting.");
      core.setOutput("passed", "true");
      core.setOutput("results", "[]");
      core.setOutput("summary", "No skill files in this PR.");
      return;
    }

    // Report results
    const context = github.context;
    const isPR = context.payload.pull_request !== undefined;

    if (isPR) {
      const token =
        core.getInput("github_token") || process.env.GITHUB_TOKEN || "";

      const reporterOptions: ReporterOptions = {
        token,
        owner: context.repo.owner,
        repo: context.repo.repo,
        prNumber: context.payload.pull_request!.number,
        sha: context.payload.pull_request!.head.sha,
        failOn: config.fail_on,
      };

      const reporter = new GitHubReporter(reporterOptions);
      const { passed, commentUrl, checkUrl } = await reporter.report(results);

      core.info(`PR comment: ${commentUrl}`);
      core.info(`Check run: ${checkUrl}`);
      core.setOutput("passed", String(passed));

      if (!passed && core.getInput("fail_on_error") !== "false") {
        core.setFailed("Skill evaluation found issues. See PR comment for details.");
      }
    } else {
      // Not a PR - just output results
      const passed = results.every(
        (r) =>
          r.lint_issues.filter((i) => i.severity === "error").length === 0 &&
          r.eval_results.every((e) => e.passed),
      );
      core.setOutput("passed", String(passed));

      if (!passed && core.getInput("fail_on_error") !== "false") {
        core.setFailed("Skill evaluation found issues.");
      }
    }

    // Set outputs
    const resultsSummary = results.map((r) => ({
      skill: r.skill.metadata.title,
      file: r.skill.relativePath,
      lint_issues: r.lint_issues.length,
      evals_passed: r.eval_results.filter((e) => e.passed).length,
      evals_total: r.eval_results.length,
      suggestions: r.suggestions.length,
    }));

    core.setOutput("results", JSON.stringify(resultsSummary));

    const summaryLines = resultsSummary.map(
      (r) =>
        `${r.skill}: ${r.lint_issues} issues, ${r.evals_passed}/${r.evals_total} evals, ${r.suggestions} suggestions`,
    );
    core.setOutput("summary", summaryLines.join("; "));

    core.info("\nDone!");
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed(String(error));
    }
  }
}

run();
