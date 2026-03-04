import { execFile } from "child_process";
import { promisify } from "util";
import { Result } from "better-result";
import { ProviderRequestError } from "../errors.js";
import type { LLMMessage, LLMProvider, LLMResponse } from "./types.js";

const execFileAsync = promisify(execFile);
const ZERO_USAGE = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

export class ClaudeCodeProvider implements LLMProvider {
  readonly name = "claude-code";
  readonly model: string;
  private cliPath: string;

  constructor(cliPath = "claude", model = "") {
    this.cliPath = cliPath;
    this.model = model || "claude-code";
  }

  async complete(messages: LLMMessage[]): Promise<Result<LLMResponse, ProviderRequestError>> {
    const systemPrompt = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const prompt = messages.filter((m) => m.role !== "system").map((m) => m.content).join("\n\n");

    const args = ["--print", "--output-format", "json"];
    if (systemPrompt) args.push("--system-prompt", systemPrompt);
    if (this.model && this.model !== "claude-code") args.push("--model", this.model);
    args.push(prompt);

    return Result.tryPromise({
      try: async () => {
        const start = Date.now();
        const { stdout } = await execFileAsync(this.cliPath, args, {
          timeout: 300_000,
          maxBuffer: 10 * 1024 * 1024,
        });
        return this.parseOutput(stdout, Date.now() - start);
      },
      catch: (cause) =>
        new ProviderRequestError({
          message: `Claude Code CLI failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          provider: "claude-code",
          cause,
        }),
    });
  }

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
