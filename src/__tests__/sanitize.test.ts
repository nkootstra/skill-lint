import { describe, expect, it } from "vitest";
import { collectSecrets, redactSecrets, redactSecretsDeep } from "../utils/sanitize.js";

describe("collectSecrets", () => {
  it("collects values from env vars matching secret patterns", () => {
    const env = {
      ANTHROPIC_API_KEY: "sk-ant-abc123xyz",
      OPENAI_API_KEY: "sk-openai-def456",
      GITHUB_TOKEN: "ghp_sometoken12345",
      MY_SECRET: "super-secret-value!",
      HOME: "/Users/test",
      PATH: "/usr/bin",
      SHORT_KEY: "abc", // Too short (< 6 chars), should be excluded
    };

    const secrets = collectSecrets(env);
    expect(secrets).toContain("sk-ant-abc123xyz");
    expect(secrets).toContain("sk-openai-def456");
    expect(secrets).toContain("ghp_sometoken12345");
    expect(secrets).toContain("super-secret-value!");
    expect(secrets).not.toContain("/Users/test");
    expect(secrets).not.toContain("/usr/bin");
    expect(secrets).not.toContain("abc");
  });

  it("returns empty array when no secrets found", () => {
    const secrets = collectSecrets({ HOME: "/Users/test", PATH: "/usr/bin" });
    expect(secrets).toEqual([]);
  });

  it("sorts secrets by length descending to prevent partial matches", () => {
    const env = {
      API_KEY: "short-key-value",
      AUTH_TOKEN: "much-longer-auth-token-value-here",
    };

    const secrets = collectSecrets(env);
    expect(secrets[0].length).toBeGreaterThanOrEqual(secrets[1].length);
  });
});

describe("redactSecrets", () => {
  it("replaces secret values with [REDACTED]", () => {
    const text = "Using API key: sk-ant-abc123 for the request";
    const result = redactSecrets(text, ["sk-ant-abc123"]);
    expect(result).toBe("Using API key: [REDACTED] for the request");
    expect(result).not.toContain("sk-ant-abc123");
  });

  it("handles multiple occurrences of the same secret", () => {
    const text = "Key sk-test appears here and sk-test appears again";
    const result = redactSecrets(text, ["sk-test"]);
    expect(result).toBe("Key [REDACTED] appears here and [REDACTED] appears again");
  });

  it("handles multiple different secrets", () => {
    const text = "API: sk-abc123, Token: ghp_xyz789";
    const result = redactSecrets(text, ["sk-abc123", "ghp_xyz789"]);
    expect(result).toBe("API: [REDACTED], Token: [REDACTED]");
  });

  it("returns text unchanged when no secrets match", () => {
    const text = "No secrets here";
    expect(redactSecrets(text, ["not-present"])).toBe(text);
  });

  it("returns text unchanged when secrets list is empty", () => {
    const text = "Some text with potential secrets";
    expect(redactSecrets(text, [])).toBe(text);
  });
});

describe("redactSecretsDeep", () => {
  it("redacts secrets from nested objects", () => {
    const obj = {
      skill: "test",
      output: "Response contained sk-ant-abc123 in text",
      nested: {
        reasoning: "Used key sk-ant-abc123 for auth",
      },
    };

    const result = redactSecretsDeep(obj, ["sk-ant-abc123"]);
    expect(result.output).toBe("Response contained [REDACTED] in text");
    expect(result.nested.reasoning).toBe("Used key [REDACTED] for auth");
    expect(result.skill).toBe("test");
  });

  it("returns value unchanged when no secrets", () => {
    const obj = { a: 1, b: "text" };
    expect(redactSecretsDeep(obj, [])).toEqual(obj);
  });
});
