import { execFile } from "child_process";
import { promisify } from "util";
import * as core from "@actions/core";
import { Result } from "better-result";
import { GitError } from "../errors.js";

const execFileAsync = promisify(execFile);

export async function getChangedFiles(baseBranch: string): Promise<string[]> {
  // Fetch base branch
  await Result.tryPromise({
    try: () => execFileAsync("git", ["fetch", "origin", baseBranch, "--depth=1"]),
    catch: (cause) => new GitError({ message: `Could not fetch ${baseBranch}`, command: "git fetch", cause }),
  });

  // Get diff
  const diff = await Result.tryPromise({
    try: async () => {
      const { stdout } = await execFileAsync("git", ["diff", "--name-only", `origin/${baseBranch}...HEAD`]);
      return stdout.trim().split("\n").filter(Boolean);
    },
    catch: (cause) => new GitError({ message: `Could not diff against ${baseBranch}`, command: "git diff", cause }),
  });

  if (diff.isOk()) return diff.value;

  core.warning(diff.error.message);

  // Fallback: diff against HEAD~1
  const fallback = await Result.tryPromise({
    try: async () => {
      const { stdout } = await execFileAsync("git", ["diff", "--name-only", "HEAD~1"]);
      return stdout.trim().split("\n").filter(Boolean);
    },
    catch: (cause) => new GitError({ message: "Could not diff against HEAD~1", command: "git diff", cause }),
  });

  return fallback.unwrapOr([]);
}

export async function getBaseBranch(): Promise<string> {
  if (process.env.GITHUB_BASE_REF) return process.env.GITHUB_BASE_REF;

  const result = await Result.tryPromise({
    try: async () => {
      const { stdout } = await execFileAsync("git", ["symbolic-ref", "refs/remotes/origin/HEAD"]);
      return stdout.trim().replace("refs/remotes/origin/", "");
    },
    catch: (cause) => new GitError({ message: "Could not determine default branch", command: "git symbolic-ref", cause }),
  });

  return result.unwrapOr("main");
}
