import * as core from "@actions/core";
import { execFile, execFileSync } from "child_process";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";
import { Result } from "better-result";
import { ProviderRequestError } from "../errors.js";
import type { LLMMessage, LLMProvider, LLMResponse } from "./types.js";

const execFileAsync = promisify(execFile);
const ZERO_USAGE = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

/** Pinned CLI version — keep in sync with anthropics/claude-code-action */
const CLAUDE_CODE_VERSION = "2.1.66";

/** Max time for a single CLI invocation (5 minutes) */
const CLI_TIMEOUT_MS = 300_000;

/** Max time for installing the CLI (2 minutes) */
const INSTALL_TIMEOUT_MS = 120_000;

export class ClaudeCodeProvider implements LLMProvider {
  readonly name = "claude-code";
  readonly model: string;
  private cliPath: string;
  private cliResolved = false;

  constructor(cliPath = "", model = "claude-haiku-4-5-20250414") {
    this.cliPath = cliPath;
    this.model = model || "claude-haiku-4-5-20250414";
  }

  async complete(messages: LLMMessage[]): Promise<Result<LLMResponse, ProviderRequestError>> {
    // Ensure the CLI is available (installs on first call if needed)
    const resolveResult = await this.ensureCli();
    if (resolveResult.isErr()) return resolveResult;

    const systemPrompt = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const prompt = messages.filter((m) => m.role !== "system").map((m) => m.content).join("\n\n");

    const args = ["--print", "--output-format", "json"];
    if (systemPrompt) args.push("--system-prompt", systemPrompt);
    if (this.model) args.push("--model", this.model);
    args.push(prompt);

    return Result.tryPromise({
      try: async () => {
        const start = Date.now();
        const { stdout } = await execFileAsync(this.cliPath, args, {
          timeout: CLI_TIMEOUT_MS,
          maxBuffer: 10 * 1024 * 1024,
          env: { ...process.env },
        });
        return this.parseOutput(stdout, Date.now() - start);
      },
      catch: (cause) =>
        new ProviderRequestError({
          message: `Claude Code CLI failed: ${classifyError(cause)}`,
          provider: "claude-code",
          cause,
        }),
    });
  }

  // ---------------------------------------------------------------------------
  // CLI resolution & auto-install
  // ---------------------------------------------------------------------------

  private async ensureCli(): Promise<Result<void, ProviderRequestError>> {
    if (this.cliResolved) return Result.ok(undefined);

    // 1. Try the explicitly configured path (if any)
    if (this.cliPath && this.isCliAvailable(this.cliPath)) {
      this.cliResolved = true;
      return Result.ok(undefined);
    }

    // 2. Try "claude" on PATH
    if (this.isCliAvailable("claude")) {
      this.cliPath = "claude";
      this.cliResolved = true;
      return Result.ok(undefined);
    }

    // 3. Try the default install location
    const defaultPath = path.join(os.homedir(), ".claude", "local", "claude");
    if (this.isCliAvailable(defaultPath)) {
      this.cliPath = defaultPath;
      this.cliResolved = true;
      return Result.ok(undefined);
    }

    // 4. Auto-install
    core.info(`Claude Code CLI not found — installing v${CLAUDE_CODE_VERSION}...`);

    const installResult = await Result.tryPromise({
      try: async () => {
        await execFileAsync(
          "bash",
          ["-c", `curl -fsSL https://claude.ai/install.sh | bash -s -- ${CLAUDE_CODE_VERSION}`],
          { timeout: INSTALL_TIMEOUT_MS, env: { ...process.env } },
        );
      },
      catch: (cause) =>
        new ProviderRequestError({
          message: `Failed to install Claude Code CLI: ${cause instanceof Error ? cause.message : String(cause)}`,
          provider: "claude-code",
          cause,
        }),
    });

    if (installResult.isErr()) return installResult;

    // Verify the install succeeded
    if (this.isCliAvailable(defaultPath)) {
      this.cliPath = defaultPath;
      this.cliResolved = true;
      core.info(`Claude Code CLI v${CLAUDE_CODE_VERSION} installed at ${defaultPath}`);
      return Result.ok(undefined);
    }

    // Also check PATH in case the installer added it elsewhere
    if (this.isCliAvailable("claude")) {
      this.cliPath = "claude";
      this.cliResolved = true;
      core.info(`Claude Code CLI v${CLAUDE_CODE_VERSION} installed`);
      return Result.ok(undefined);
    }

    return Result.err(
      new ProviderRequestError({
        message: "Claude Code CLI installation completed but binary not found. Check PATH or set claude_code_path explicitly.",
        provider: "claude-code",
        cause: null,
      }),
    );
  }

  private isCliAvailable(bin: string): boolean {
    try {
      execFileSync(bin, ["--version"], { stdio: "ignore", timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Output parsing
  // ---------------------------------------------------------------------------

  private parseOutput(stdout: string, latency_ms: number): LLMResponse {
    const parsed = Result.try(() => JSON.parse(stdout) as Record<string, unknown>);

    if (parsed.isErr()) {
      return { content: stdout.trim(), usage: ZERO_USAGE, latency_ms, model: this.model };
    }

    const data = parsed.value;
    const rawUsage = data.usage as Record<string, number> | undefined;

    return {
      content: (data.result ?? data.content ?? stdout) as string,
      usage: rawUsage
        ? {
            input_tokens: rawUsage.input_tokens ?? 0,
            output_tokens: rawUsage.output_tokens ?? 0,
            total_tokens: (rawUsage.input_tokens ?? 0) + (rawUsage.output_tokens ?? 0),
          }
        : ZERO_USAGE,
      latency_ms,
      model: this.model,
    };
  }
}

// -----------------------------------------------------------------------------
// Error classification
// -----------------------------------------------------------------------------

/** Turn raw CLI errors into actionable messages. */
function classifyError(cause: unknown): string {
  const msg = cause instanceof Error ? cause.message : String(cause);
  const stderr = (cause as { stderr?: string })?.stderr ?? "";
  const combined = `${msg}\n${stderr}`;

  if (combined.includes("ENOENT")) {
    return "Claude Code CLI binary not found. Ensure the CLI is installed or set claude_code_path.";
  }

  if (
    combined.includes("expired") ||
    combined.includes("token") && combined.includes("invalid") ||
    combined.includes("401") ||
    combined.includes("Unauthorized") ||
    combined.includes("authentication")
  ) {
    return (
      "Authentication failed — your OAuth token may be expired or invalid. " +
      "Run 'claude setup-token' locally to generate a new token, then update the CLAUDE_CODE_OAUTH_TOKEN secret."
    );
  }

  if (combined.includes("ETIMEDOUT") || combined.includes("timeout")) {
    return "Claude Code CLI timed out. The model may be overloaded — try again or increase the timeout.";
  }

  if (combined.includes("rate") && combined.includes("limit")) {
    return "Rate limited by the API. Wait a moment and re-run the workflow.";
  }

  return msg;
}
