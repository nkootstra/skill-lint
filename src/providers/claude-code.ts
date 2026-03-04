import { execFile } from "child_process";
import { promisify } from "util";
import type { LLMMessage, LLMProvider, LLMResponse } from "./types.js";

const execFileAsync = promisify(execFile);

/**
 * Claude Code provider - shells out to the Claude CLI.
 * Uses your existing Claude Max/Pro subscription, no API key needed.
 */
export class ClaudeCodeProvider implements LLMProvider {
  readonly name = "claude-code";
  readonly model: string;
  private cliPath: string;

  constructor(cliPath = "claude", model = "") {
    this.cliPath = cliPath;
    this.model = model || "claude-code";
  }

  async complete(messages: LLMMessage[]): Promise<LLMResponse> {
    const systemMessages = messages.filter((m) => m.role === "system");
    const userMessages = messages.filter((m) => m.role !== "system");

    const systemPrompt = systemMessages.map((m) => m.content).join("\n\n");
    const prompt = userMessages.map((m) => m.content).join("\n\n");

    const args = ["--print", "--output-format", "json"];

    if (systemPrompt) {
      args.push("--system-prompt", systemPrompt);
    }

    if (this.model && this.model !== "claude-code") {
      args.push("--model", this.model);
    }

    args.push(prompt);

    const start = Date.now();

    const { stdout } = await execFileAsync(this.cliPath, args, {
      timeout: 300_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    const latency_ms = Date.now() - start;

    let content: string;
    let usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

    try {
      const parsed = JSON.parse(stdout);
      content = parsed.result ?? parsed.content ?? stdout;

      if (parsed.usage) {
        usage = {
          input_tokens: parsed.usage.input_tokens ?? 0,
          output_tokens: parsed.usage.output_tokens ?? 0,
          total_tokens:
            (parsed.usage.input_tokens ?? 0) +
            (parsed.usage.output_tokens ?? 0),
        };
      }
    } catch {
      content = stdout.trim();
    }

    return {
      content,
      usage,
      latency_ms,
      model: this.model || "claude-code",
    };
  }
}
