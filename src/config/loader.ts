import * as core from "@actions/core";
import * as fs from "fs";
import * as path from "path";
import { Result } from "better-result";
import { parse as parseYaml } from "yaml";
import { ConfigValidationError } from "../errors.js";
import { configSchema, type Config, type ProviderConfig } from "./schema.js";

export function loadConfig(
  configPath: string,
): Result<Config, ConfigValidationError> {
  const fullPath = path.resolve(configPath);

  let rawConfig: Record<string, unknown> = {};

  if (fs.existsSync(fullPath)) {
    const content = fs.readFileSync(fullPath, "utf-8");
    rawConfig = parseYaml(content) ?? {};
    core.info(`Loaded config from ${fullPath}`);
  } else {
    core.info(`No config file found at ${fullPath}, using defaults`);
  }

  const merged = { ...rawConfig, ...getActionInputOverrides() };
  const parsed = configSchema.safeParse(merged);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    return Result.err(new ConfigValidationError({
      message: `Invalid config:\n${issues.map((i) => `  - ${i}`).join("\n")}`,
      issues,
    }));
  }

  return Result.ok(parsed.data);
}

function getActionInputOverrides(): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};

  const skillsPath = core.getInput("skills_path");
  if (skillsPath) overrides.skills_path = skillsPath;

  const providerType = core.getInput("provider");
  if (providerType) {
    const config = buildProviderConfig(providerType);
    if (config) overrides.provider = config;
  }

  return overrides;
}

function buildProviderConfig(providerType: string): ProviderConfig | undefined {
  const model = core.getInput("model");

  switch (providerType) {
    case "anthropic":
      return { type: "anthropic", model: model || "claude-sonnet-4-20250514", api_key_env: "ANTHROPIC_API_KEY" };
    case "openai":
      return { type: "openai", model: model || "gpt-4o", api_key_env: "OPENAI_API_KEY" };
    case "litellm":
      if (!model) return undefined;
      const apiBase = core.getInput("litellm_api_base");
      return { type: "litellm", model, api_key_env: "LITELLM_API_KEY", ...(apiBase ? { api_base: apiBase } : {}) };
    case "claude-code":
      return { type: "claude-code", model: model || "", cli_path: core.getInput("claude_code_path") || "claude" };
    default:
      return undefined;
  }
}
