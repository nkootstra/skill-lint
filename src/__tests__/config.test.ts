import { describe, expect, it } from "vitest";
import { configSchema } from "../config/schema.js";

describe("configSchema", () => {
  it("should parse defaults when given empty object", () => {
    const result = configSchema.parse({});
    expect(result.skills_path).toBe("skills");
    expect(result.fail_on).toBe("error");
    expect(result.parallel_evals).toBe(3);
    expect(result.provider.type).toBe("anthropic");
  });

  it("should accept valid anthropic provider config", () => {
    const result = configSchema.parse({
      provider: {
        type: "anthropic",
        model: "claude-sonnet-4-20250514",
        api_key_env: "MY_KEY",
      },
    });
    expect(result.provider.type).toBe("anthropic");
    if (result.provider.type === "anthropic") {
      expect(result.provider.model).toBe("claude-sonnet-4-20250514");
      expect(result.provider.api_key_env).toBe("MY_KEY");
    }
  });

  it("should accept valid openai provider config", () => {
    const result = configSchema.parse({
      provider: {
        type: "openai",
        model: "gpt-4o",
      },
    });
    expect(result.provider.type).toBe("openai");
  });

  it("should accept valid litellm provider config", () => {
    const result = configSchema.parse({
      provider: {
        type: "litellm",
        model: "anthropic/claude-sonnet-4-20250514",
        api_base: "http://localhost:4000",
      },
    });
    expect(result.provider.type).toBe("litellm");
  });

  it("should accept valid claude-code provider config", () => {
    const result = configSchema.parse({
      provider: {
        type: "claude-code",
        cli_path: "/usr/local/bin/claude",
      },
    });
    expect(result.provider.type).toBe("claude-code");
    if (result.provider.type === "claude-code") {
      expect(result.provider.cli_path).toBe("/usr/local/bin/claude");
    }
  });

  it("should default claude-code model to claude-haiku-4-5-20250414", () => {
    const result = configSchema.parse({
      provider: { type: "claude-code" },
    });
    expect(result.provider.type).toBe("claude-code");
    if (result.provider.type === "claude-code") {
      expect(result.provider.model).toBe("claude-haiku-4-5-20250414");
      expect(result.provider.cli_path).toBe("");
    }
  });

  it("should reject invalid provider type", () => {
    expect(() =>
      configSchema.parse({
        provider: { type: "invalid" },
      }),
    ).toThrow();
  });

  it("should parse rubric with custom rules", () => {
    const result = configSchema.parse({
      rubric: {
        require_description: true,
        require_examples: true,
        max_instruction_tokens: 2000,
        rules: [
          {
            id: "my-rule",
            description: "Check something",
            severity: "error",
          },
        ],
        custom_prompts: {
          "my-rule": "Check if the skill does something specific",
        },
      },
    });

    expect(result.rubric.rules).toHaveLength(1);
    expect(result.rubric.rules[0].id).toBe("my-rule");
    expect(result.rubric.max_instruction_tokens).toBe(2000);
    expect(result.rubric.custom_prompts["my-rule"]).toBeDefined();
  });

  it("should clamp parallel_evals within bounds", () => {
    expect(() => configSchema.parse({ parallel_evals: 0 })).toThrow();
    expect(() => configSchema.parse({ parallel_evals: 11 })).toThrow();

    const result = configSchema.parse({ parallel_evals: 5 });
    expect(result.parallel_evals).toBe(5);
  });

  it("should default eval_trials to 1", () => {
    const result = configSchema.parse({});
    expect(result.eval_trials).toBe(1);
  });

  it("should accept eval_trials within bounds", () => {
    const result = configSchema.parse({ eval_trials: 5 });
    expect(result.eval_trials).toBe(5);
  });

  it("should reject eval_trials out of bounds", () => {
    expect(() => configSchema.parse({ eval_trials: 0 })).toThrow();
    expect(() => configSchema.parse({ eval_trials: 11 })).toThrow();
  });

  it("should default redact_secrets to true", () => {
    const result = configSchema.parse({});
    expect(result.redact_secrets).toBe(true);
  });

  it("should allow disabling redact_secrets", () => {
    const result = configSchema.parse({ redact_secrets: false });
    expect(result.redact_secrets).toBe(false);
  });
});
