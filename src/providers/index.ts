import * as core from "@actions/core";
import { Result } from "better-result";
import type { ProviderConfig } from "../config/schema.js";
import { ApiKeyMissingError } from "../errors.js";
import { AnthropicProvider } from "./anthropic.js";
import { ClaudeCodeProvider } from "./claude-code.js";
import { LiteLLMProvider } from "./litellm.js";
import { OpenAIProvider } from "./openai.js";
import type { LLMProvider } from "./types.js";

export { type LLMMessage, type LLMProvider, type LLMResponse } from "./types.js";

export function createProvider(
  config: ProviderConfig,
): Result<LLMProvider, ApiKeyMissingError> {
  switch (config.type) {
    case "anthropic": {
      const apiKey = resolveKey("anthropic_api_key", config.api_key_env, "ANTHROPIC_API_KEY");
      if (!apiKey) {
        return Result.err(new ApiKeyMissingError({
          message: "Anthropic API key not found",
          provider: "anthropic",
          envVar: config.api_key_env,
        }));
      }
      return Result.ok(new AnthropicProvider(apiKey, config.model));
    }

    case "openai": {
      const apiKey = resolveKey("openai_api_key", config.api_key_env, "OPENAI_API_KEY");
      if (!apiKey) {
        return Result.err(new ApiKeyMissingError({
          message: "OpenAI API key not found",
          provider: "openai",
          envVar: config.api_key_env,
        }));
      }
      return Result.ok(new OpenAIProvider(apiKey, config.model));
    }

    case "litellm": {
      const apiKey = resolveKey("litellm_api_key", config.api_key_env, "LITELLM_API_KEY");
      return Result.ok(new LiteLLMProvider(apiKey ?? "", config.model, config.api_base));
    }

    case "claude-code":
      return Result.ok(new ClaudeCodeProvider(config.cli_path, config.model));
  }
}

function resolveKey(inputName: string, envName: string, fallbackEnv: string): string | undefined {
  return core.getInput(inputName) || process.env[envName] || process.env[fallbackEnv] || undefined;
}
