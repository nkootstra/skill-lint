import type { LLMMessage, LLMProvider, LLMResponse } from "./types.js";

/**
 * Plugin interface for extending skill-lint with custom LLM providers.
 *
 * To create a custom provider plugin:
 * 1. Create a JS/TS module that exports a `createProvider` function
 * 2. Reference it in .skill-lint.yml under provider.plugin_path
 *
 * Example .skill-lint.yml:
 *   provider:
 *     type: plugin
 *     plugin_path: ./my-provider.js
 *     config:
 *       my_option: value
 */
export interface ProviderPlugin {
  createProvider(config: Record<string, unknown>): LLMProvider;
}

/**
 * Wraps an external command as an LLM provider.
 * Useful for integrating any GitHub App or CLI tool that accepts
 * a prompt on stdin and returns a response on stdout.
 *
 * Example .skill-lint.yml:
 *   provider:
 *     type: command
 *     command: "my-github-app-cli evaluate"
 *     args: ["--format", "json"]
 */
export class CommandProvider implements LLMProvider {
  readonly name: string;
  readonly model: string;
  private command: string;
  private args: string[];

  constructor(
    name: string,
    command: string,
    args: string[] = [],
    model = "custom",
  ) {
    this.name = name;
    this.model = model;
    this.command = command;
    this.args = args;
  }

  async complete(messages: LLMMessage[]): Promise<LLMResponse> {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);

    const input = JSON.stringify(messages);
    const start = Date.now();

    const { stdout } = await execFileAsync(this.command, this.args, {
      timeout: 300_000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, SKILL_LINT_INPUT: input },
    });

    const latency_ms = Date.now() - start;

    try {
      const parsed = JSON.parse(stdout);
      return {
        content: parsed.content ?? stdout,
        usage: parsed.usage ?? {
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
        },
        latency_ms,
        model: parsed.model ?? this.model,
      };
    } catch {
      return {
        content: stdout.trim(),
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        latency_ms,
        model: this.model,
      };
    }
  }
}

/**
 * Load a provider plugin from a local JS module.
 */
export async function loadPlugin(pluginPath: string): Promise<ProviderPlugin> {
  const { resolve } = await import("path");
  const fullPath = resolve(pluginPath);
  const mod = (await import(fullPath)) as ProviderPlugin | { default: ProviderPlugin };

  if ("default" in mod && typeof (mod.default as ProviderPlugin).createProvider === "function") {
    return mod.default as ProviderPlugin;
  }

  if (typeof (mod as ProviderPlugin).createProvider === "function") {
    return mod as ProviderPlugin;
  }

  throw new Error(
    `Plugin at ${pluginPath} must export a createProvider function`,
  );
}
