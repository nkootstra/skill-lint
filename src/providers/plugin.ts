import { Result } from "better-result";
import { ProviderRequestError } from "../errors.js";
import type { LLMMessage, LLMProvider, LLMResponse } from "./types.js";

/**
 * Plugin interface for extending skill-lint with custom LLM providers.
 */
export interface ProviderPlugin {
  createProvider(config: Record<string, unknown>): LLMProvider;
}

/**
 * Wraps an external command as an LLM provider.
 * Useful for integrating any GitHub App or CLI tool.
 */
export class CommandProvider implements LLMProvider {
  readonly name: string;
  readonly model: string;
  private command: string;
  private args: string[];

  constructor(name: string, command: string, args: string[] = [], model = "custom") {
    this.name = name;
    this.model = model;
    this.command = command;
    this.args = args;
  }

  async complete(messages: LLMMessage[]): Promise<Result<LLMResponse, ProviderRequestError>> {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);

    const input = JSON.stringify(messages);

    return Result.tryPromise({
      try: async () => {
        const start = Date.now();
        const { stdout } = await execFileAsync(this.command, this.args, {
          timeout: 300_000,
          maxBuffer: 10 * 1024 * 1024,
          env: { ...process.env, SKILL_LINT_INPUT: input },
        });

        const latency_ms = Date.now() - start;
        const parsed = Result.try(() => JSON.parse(stdout) as Record<string, unknown>);

        if (parsed.isOk()) {
          return {
            content: (parsed.value.content ?? stdout) as string,
            usage: (parsed.value.usage as LLMResponse["usage"]) ?? { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
            latency_ms,
            model: (parsed.value.model as string) ?? this.model,
          };
        }

        return {
          content: stdout.trim(),
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          latency_ms,
          model: this.model,
        };
      },
      catch: (cause) =>
        new ProviderRequestError({
          message: `Command provider failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          provider: this.name,
          cause,
        }),
    });
  }
}

/**
 * Load a provider plugin from a local JS module.
 */
export async function loadPlugin(pluginPath: string): Promise<Result<ProviderPlugin, ProviderRequestError>> {
  const { resolve } = await import("path");
  const fullPath = resolve(pluginPath);

  return Result.tryPromise({
    try: async () => {
      const mod = (await import(fullPath)) as ProviderPlugin | { default: ProviderPlugin };

      if ("default" in mod && typeof (mod.default as ProviderPlugin).createProvider === "function") {
        return mod.default as ProviderPlugin;
      }
      if (typeof (mod as ProviderPlugin).createProvider === "function") {
        return mod as ProviderPlugin;
      }
      throw new Error(`Plugin at ${pluginPath} must export a createProvider function`);
    },
    catch: (cause) =>
      new ProviderRequestError({
        message: `Failed to load plugin: ${cause instanceof Error ? cause.message : String(cause)}`,
        provider: "plugin",
        cause,
      }),
  });
}
