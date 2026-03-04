import * as core from "@actions/core";
import * as fs from "fs";
import * as path from "path";
import { parse as parseYaml } from "yaml";
import { configSchema, type Config, type ProviderConfig } from "./schema.js";

export function loadConfig(configPath: string): Config {
  const fullPath = path.resolve(configPath);

  let rawConfig: Record<string, unknown> = {};

  if (fs.existsSync(fullPath)) {
    const content = fs.readFileSync(fullPath, "utf-8");
    rawConfig = parseYaml(content) ?? {};
    core.info(`Loaded config from ${fullPath}`);
  } else {
    core.info(`No config file found at ${fullPath}, using defaults`);
  }

  const actionOverrides = getActionInputOverrides();
  const merged = { ...rawConfig, ...actionOverrides };

  const result = configSchema.safeParse(merged);
  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid config:\n${errors}`);
  }

  return result.data;
}

function getActionInputOverrides(): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};

  const skillsPath = core.getInput("skills_path");
  if (skillsPath) {
    overrides.skills_path = skillsPath;
  }

  const providerType = core.getInput("provider");
  if (providerType) {
    const providerConfig = buildProviderConfig(providerType);
    if (providerConfig) {
      overrides.provider = providerConfig;
    }
  }

  return overrides;
}

function buildProviderConfig(
  providerType: string,
): ProviderConfig | undefined {
  const model = core.getInput("model");

  switch (providerType) {
    case "anthropic":
      return {
        type: "anthropic" as const,
        model: model || "claude-sonnet-4-20250514",
        api_key_env: "ANTHROPIC_API_KEY",
      };
    case "openai":
      return {
        type: "openai" as const,
        model: model || "gpt-4o",
        api_key_env: "OPENAI_API_KEY",
      };
    case "litellm": {
      if (!model) return undefined;
      const apiBase = core.getInput("litellm_api_base");
      return {
        type: "litellm" as const,
        model,
        api_key_env: "LITELLM_API_KEY",
        ...(apiBase ? { api_base: apiBase } : {}),
      };
    }
    case "claude-code": {
      const cliPath = core.getInput("claude_code_path") || "claude";
      return {
        type: "claude-code" as const,
        model: model || "",
        cli_path: cliPath,
      };
    }
    default:
      return undefined;
  }
}
