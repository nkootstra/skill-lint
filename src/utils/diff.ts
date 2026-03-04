import { execFile } from "child_process";
import { promisify } from "util";
import * as core from "@actions/core";

const execFileAsync = promisify(execFile);

/**
 * Get list of files changed in a PR compared to the base branch.
 */
export async function getChangedFiles(baseBranch: string): Promise<string[]> {
  try {
    // Fetch the base branch for comparison
    await execFileAsync("git", ["fetch", "origin", baseBranch, "--depth=1"]);
  } catch (error) {
    core.warning(
      `Could not fetch base branch ${baseBranch}: ${error instanceof Error ? error.message : error}`,
    );
  }

  try {
    const { stdout } = await execFileAsync("git", [
      "diff",
      "--name-only",
      `origin/${baseBranch}...HEAD`,
    ]);

    return stdout
      .trim()
      .split("\n")
      .filter((f) => f.length > 0);
  } catch (error) {
    core.warning(
      `Could not get diff against ${baseBranch}: ${error instanceof Error ? error.message : error}`,
    );

    // Fallback: try comparing with HEAD~1
    try {
      const { stdout } = await execFileAsync("git", [
        "diff",
        "--name-only",
        "HEAD~1",
      ]);
      return stdout
        .trim()
        .split("\n")
        .filter((f) => f.length > 0);
    } catch {
      return [];
    }
  }
}

/**
 * Get the base branch from GitHub context or git.
 */
export async function getBaseBranch(): Promise<string> {
  // Try GitHub event payload
  const baseBranch = process.env.GITHUB_BASE_REF;
  if (baseBranch) return baseBranch;

  // Fallback: try to determine default branch
  try {
    const { stdout } = await execFileAsync("git", [
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
    ]);
    return stdout.trim().replace("refs/remotes/origin/", "");
  } catch {
    return "main";
  }
}
