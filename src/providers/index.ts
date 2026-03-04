import * as core from "@actions/core";
import type { ProviderConfig } from "../config/schema.js";
import { AnthropicProvider } from "./anthropic.js";
import { ClaudeCodeProvider } from "./claude-code.js";
import { LiteLLMProvider } from "./litellm.js";
import { OpenAIProvider } from "./openai.js";
import type { LLMProvider } from "./types.js";

export { type LLMMessage, type LLMProvider, type LLMResponse } from "./types.js";

export function createProvider(config: ProviderConfig): LLMProvider {
  switch (config.type) {
    case "anthropic": {
      const apiKey =
        core.getInput("anthropic_api_key") ||
        process.env[config.api_key_env] ||
        process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error(
          `Anthropic API key not found. Set it via the anthropic_api_key input or ${config.api_key_env} environment variable.`,
        );
      }
      return new AnthropicProvider(apiKey, config.model);
    }

    case "openai": {
      const apiKey =
        core.getInput("openai_api_key") ||
        process.env[config.api_key_env] ||
        process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error(
          `OpenAI API key not found. Set it via the openai_api_key input or ${config.api_key_env} environment variable.`,
        );
      }
      return new OpenAIProvider(apiKey, config.model);
    }

    case "litellm": {
      const apiKey =
        core.getInput("litellm_api_key") ||
        process.env[config.api_key_env] ||
        process.env.LITELLM_API_KEY ||
        "";
      return new LiteLLMProvider(apiKey, config.model, config.api_base);
    }

    case "claude-code": {
      return new ClaudeCodeProvider(config.cli_path, config.model);
    }

    default: {
      const _exhaustive: never = config;
      throw new Error(`Unknown provider: ${(_exhaustive as ProviderConfig).type}`);
    }
  }
}
