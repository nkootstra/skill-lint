import { z } from "zod";

export const rubricRuleSchema = z.object({
  id: z.string(),
  description: z.string(),
  severity: z.enum(["error", "warning", "info"]).default("warning"),
  enabled: z.boolean().default(true),
});

export const rubricSchema = z.object({
  rules: z.array(rubricRuleSchema).default([]),
  require_description: z
    .boolean()
    .default(true)
    .describe("Skill must have a description"),
  require_examples: z
    .boolean()
    .default(false)
    .describe("Skill must include usage examples"),
  require_triggers: z
    .boolean()
    .default(true)
    .describe("Skill must define trigger conditions"),
  require_security: z
    .boolean()
    .default(true)
    .describe("Run security checks to detect malicious patterns in skills"),
  max_instruction_tokens: z
    .number()
    .optional()
    .describe("Maximum token count for skill instructions"),
  custom_prompts: z
    .record(z.string())
    .default({})
    .describe("Custom LLM evaluation prompts keyed by rule ID"),
});

export const providerConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("anthropic"),
    model: z.string().default("claude-sonnet-4-20250514"),
    api_key_env: z.string().default("ANTHROPIC_API_KEY"),
  }),
  z.object({
    type: z.literal("openai"),
    model: z.string().default("gpt-4o"),
    api_key_env: z.string().default("OPENAI_API_KEY"),
  }),
  z.object({
    type: z.literal("litellm"),
    model: z.string(),
    api_key_env: z.string().default("LITELLM_API_KEY"),
    api_base: z.string().optional(),
  }),
  z.object({
    type: z.literal("claude-code"),
    model: z.string().default("claude-haiku-4-5-20250414"),
    cli_path: z.string().default(""),
  }),
]);

export const evalPresetSchema = z.enum(["smoke", "reliable", "regression"]);

export const EVAL_PRESET_TRIALS: Record<z.infer<typeof evalPresetSchema>, number> = {
  smoke: 3,
  reliable: 10,
  regression: 25,
};

export const configSchema = z.object({
  skills_path: z.string().default("skills"),
  skill_filename: z.string().default("SKILL.md").describe("Default skill filename within each skill directory"),
  eval_pattern: z.string().default("*.eval.yml"),
  provider: providerConfigSchema.default({ type: "anthropic" }),
  rubric: rubricSchema.default({}),
  fail_on: z.enum(["error", "warning", "never"]).default("error"),
  parallel_evals: z.number().min(1).max(10).default(3),
  eval_preset: evalPresetSchema
    .optional()
    .describe("Eval preset: smoke (3 trials), reliable (10 trials), regression (25 trials). Overridden by explicit eval_trials."),
  eval_trials: z
    .number()
    .min(1)
    .max(50)
    .default(1)
    .describe("Number of trials per eval test case for pass@k/pass^k metrics (1 = no multi-trial)"),
  redact_secrets: z
    .boolean()
    .default(true)
    .describe("Auto-redact API keys and secrets from PR comments and outputs"),
  min_pass_rate: z
    .number()
    .min(0)
    .max(1)
    .default(1.0)
    .describe("Minimum eval pass rate (0.0-1.0) to consider the run successful. Default 1.0 requires all evals to pass."),
  benchmark: z
    .object({
      enabled: z.boolean().default(true),
      track_tokens: z.boolean().default(true),
      track_latency: z.boolean().default(true),
    })
    .default({}),
});

export type Config = z.infer<typeof configSchema>;
export type ProviderConfig = z.infer<typeof providerConfigSchema>;
export type Rubric = z.infer<typeof rubricSchema>;
export type RubricRule = z.infer<typeof rubricRuleSchema>;
