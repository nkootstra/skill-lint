import * as fs from "fs";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseEvalFile, parseSkill } from "../skills/parser.js";
import type { DetectedFile } from "../skills/detector.js";

const TEST_DIR = path.join(process.cwd(), "__test_fixtures__");

beforeAll(() => {
  // Directory-based skill with references
  fs.mkdirSync(path.join(TEST_DIR, "my-skill", "references"), { recursive: true });

  fs.writeFileSync(
    path.join(TEST_DIR, "my-skill", "SKILL.md"),
    `---
title: Test Skill
description: A test skill
triggers:
  - "test"
---

Do the test thing with care and precision.
`,
  );

  fs.writeFileSync(
    path.join(TEST_DIR, "my-skill", "references", "guide.md"),
    "# Reference Guide\nSome reference content.",
  );

  // Flat YAML skill
  fs.writeFileSync(
    path.join(TEST_DIR, "flat-skill.yml"),
    `title: YAML Skill
description: A YAML-based skill
triggers:
  - "yaml test"
instructions: |
  Follow these YAML-based instructions carefully.
`,
  );

  // Flat JSON skill
  fs.writeFileSync(
    path.join(TEST_DIR, "flat-skill.json"),
    JSON.stringify({
      title: "JSON Skill",
      description: "A JSON-based skill",
      triggers: ["json test"],
      instructions: "Follow these JSON instructions.",
    }),
  );

  // Eval file
  fs.writeFileSync(
    path.join(TEST_DIR, "my-skill", "SKILL.eval.yml"),
    `skill: my-skill
tests:
  - name: Basic test
    prompt: "Hello"
    expected: "Should greet back"
    required_keywords:
      - "hello"
  - name: Pattern test
    prompt: "Format this"
    expected: "Should format"
    match_pattern: "formatted"
`,
  );
});

afterAll(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("parseSkill", () => {
  it("parses markdown skill with frontmatter", () => {
    const file: DetectedFile = {
      absolutePath: path.join(TEST_DIR, "my-skill", "SKILL.md"),
      relativePath: path.join("my-skill", "SKILL.md"),
      type: "skill",
      format: "markdown",
      skillDirName: "my-skill",
    };

    const skill = parseSkill(file);

    expect(skill.metadata.title).toBe("Test Skill");
    expect(skill.metadata.description).toBe("A test skill");
    expect(skill.metadata.triggers).toEqual(["test"]);
    expect(skill.instructions).toContain("Do the test thing");
    expect(skill.format).toBe("markdown");
    expect(skill.skillName).toBe("my-skill");
  });

  it("loads references from references/ subdirectory", () => {
    const file: DetectedFile = {
      absolutePath: path.join(TEST_DIR, "my-skill", "SKILL.md"),
      relativePath: path.join("my-skill", "SKILL.md"),
      type: "skill",
      format: "markdown",
      skillDirName: "my-skill",
    };

    const skill = parseSkill(file);

    expect(skill.references).toHaveLength(1);
    expect(skill.references[0].name).toBe("guide.md");
    expect(skill.references[0].content).toContain("Reference Guide");
  });

  it("parses YAML skill", () => {
    const file: DetectedFile = {
      absolutePath: path.join(TEST_DIR, "flat-skill.yml"),
      relativePath: "flat-skill.yml",
      type: "skill",
      format: "yaml",
    };

    const skill = parseSkill(file);

    expect(skill.metadata.title).toBe("YAML Skill");
    expect(skill.instructions).toContain("YAML-based instructions");
    expect(skill.skillName).toBe("flat-skill");
    expect(skill.references).toHaveLength(0);
  });

  it("parses JSON skill", () => {
    const file: DetectedFile = {
      absolutePath: path.join(TEST_DIR, "flat-skill.json"),
      relativePath: "flat-skill.json",
      type: "skill",
      format: "json",
    };

    const skill = parseSkill(file);

    expect(skill.metadata.title).toBe("JSON Skill");
    expect(skill.instructions).toContain("JSON instructions");
  });
});

describe("parseEvalFile", () => {
  it("parses eval file with test cases", () => {
    const file: DetectedFile = {
      absolutePath: path.join(TEST_DIR, "my-skill", "SKILL.eval.yml"),
      relativePath: path.join("my-skill", "SKILL.eval.yml"),
      type: "eval",
      format: "yaml",
      skillDirName: "my-skill",
    };

    const evalFile = parseEvalFile(file);

    expect(evalFile.skillPath).toBe("my-skill");
    expect(evalFile.tests).toHaveLength(2);
    expect(evalFile.tests[0].name).toBe("Basic test");
    expect(evalFile.tests[0].required_keywords).toEqual(["hello"]);
    expect(evalFile.tests[1].match_pattern).toBe("formatted");
  });

  it("parses eval file with weighted graders", () => {
    const evalWithGraders = path.join(TEST_DIR, "graders-eval.yml");
    fs.writeFileSync(
      evalWithGraders,
      `skill: my-skill
tests:
  - name: Weighted test
    prompt: "Review this"
    expected: "Should find issues"
    graders:
      - type: hard_constraints
        weight: 0.7
        required_keywords:
          - "vulnerability"
      - type: llm_rubric
        weight: 0.3
        expected: "Identifies security issues"
      - type: script
        weight: 0.1
        command: "echo 0.8"
`,
    );

    const file: DetectedFile = {
      absolutePath: evalWithGraders,
      relativePath: "graders-eval.yml",
      type: "eval",
      format: "yaml",
    };

    const evalFile = parseEvalFile(file);

    expect(evalFile.tests).toHaveLength(1);
    expect(evalFile.tests[0].graders).toBeDefined();
    expect(evalFile.tests[0].graders).toHaveLength(3);
    expect(evalFile.tests[0].graders![0].type).toBe("hard_constraints");
    expect(evalFile.tests[0].graders![0].weight).toBe(0.7);
    expect(evalFile.tests[0].graders![0].required_keywords).toEqual(["vulnerability"]);
    expect(evalFile.tests[0].graders![1].type).toBe("llm_rubric");
    expect(evalFile.tests[0].graders![1].expected).toBe("Identifies security issues");
    expect(evalFile.tests[0].graders![2].type).toBe("script");
    expect(evalFile.tests[0].graders![2].command).toBe("echo 0.8");
  });

  it("returns undefined graders when none specified (backward compatible)", () => {
    const file: DetectedFile = {
      absolutePath: path.join(TEST_DIR, "my-skill", "SKILL.eval.yml"),
      relativePath: path.join("my-skill", "SKILL.eval.yml"),
      type: "eval",
      format: "yaml",
      skillDirName: "my-skill",
    };

    const evalFile = parseEvalFile(file);
    // Existing eval files without graders should have undefined graders
    expect(evalFile.tests[0].graders).toBeUndefined();
  });

  it("parses Anthropic-format evals.json with evals key, id, and expected_output", () => {
    const anthropicEvalPath = path.join(TEST_DIR, "anthropic-evals.json");
    fs.writeFileSync(
      anthropicEvalPath,
      JSON.stringify({
        skill_name: "my-anthropic-skill",
        evals: [
          {
            id: 1,
            prompt: "Write a hello world function",
            expected_output: "Should produce a working function",
            files: ["evals/files/sample.py"],
            expectations: [
              "The output includes a function definition",
              "The function prints hello world",
            ],
          },
          {
            id: 2,
            prompt: "Explain recursion",
            expected_output: "Should explain recursion clearly",
          },
        ],
      }),
    );

    const file: DetectedFile = {
      absolutePath: anthropicEvalPath,
      relativePath: "anthropic-evals.json",
      type: "eval",
      format: "json",
    };

    const evalFile = parseEvalFile(file);

    expect(evalFile.skillPath).toBe("my-anthropic-skill");
    expect(evalFile.tests).toHaveLength(2);

    // First test case
    expect(evalFile.tests[0].name).toBe("eval-1");
    expect(evalFile.tests[0].id).toBe(1);
    expect(evalFile.tests[0].prompt).toBe("Write a hello world function");
    expect(evalFile.tests[0].expected).toBe("Should produce a working function");
    expect(evalFile.tests[0].files).toEqual(["evals/files/sample.py"]);
    expect(evalFile.tests[0].expectations).toEqual([
      "The output includes a function definition",
      "The function prints hello world",
    ]);

    // Second test case (no files/expectations)
    expect(evalFile.tests[1].name).toBe("eval-2");
    expect(evalFile.tests[1].id).toBe(2);
    expect(evalFile.tests[1].expected).toBe("Should explain recursion clearly");
    expect(evalFile.tests[1].files).toBeUndefined();
    expect(evalFile.tests[1].expectations).toBeUndefined();
  });

  it("maps skill_name to skillPath for Anthropic format", () => {
    const evalPath = path.join(TEST_DIR, "skill-name-test.json");
    fs.writeFileSync(
      evalPath,
      JSON.stringify({
        skill_name: "special-skill",
        evals: [{ id: 1, prompt: "test", expected_output: "result" }],
      }),
    );

    const file: DetectedFile = {
      absolutePath: evalPath,
      relativePath: "skill-name-test.json",
      type: "eval",
      format: "json",
    };

    const evalFile = parseEvalFile(file);
    expect(evalFile.skillPath).toBe("special-skill");
  });

  it("preserves backward compatibility with tests/test_cases keys", () => {
    const file: DetectedFile = {
      absolutePath: path.join(TEST_DIR, "my-skill", "SKILL.eval.yml"),
      relativePath: path.join("my-skill", "SKILL.eval.yml"),
      type: "eval",
      format: "yaml",
      skillDirName: "my-skill",
    };

    const evalFile = parseEvalFile(file);

    // Existing format should still work unchanged
    expect(evalFile.skillPath).toBe("my-skill");
    expect(evalFile.tests).toHaveLength(2);
    expect(evalFile.tests[0].name).toBe("Basic test");
    expect(evalFile.tests[0].expected).toBe("Should greet back");
    expect(evalFile.tests[0].id).toBeUndefined();
    expect(evalFile.tests[0].files).toBeUndefined();
    expect(evalFile.tests[0].expectations).toBeUndefined();
  });

  it("falls back to skill field when skill_name is not present", () => {
    const evalPath = path.join(TEST_DIR, "fallback-skill.json");
    fs.writeFileSync(
      evalPath,
      JSON.stringify({
        skill: "fallback-skill",
        tests: [{ name: "test", prompt: "hello", expected: "world" }],
      }),
    );

    const file: DetectedFile = {
      absolutePath: evalPath,
      relativePath: "fallback-skill.json",
      type: "eval",
      format: "json",
    };

    const evalFile = parseEvalFile(file);
    expect(evalFile.skillPath).toBe("fallback-skill");
    expect(evalFile.tests[0].name).toBe("test");
  });

  it("preserves empty files array (not converted to undefined)", () => {
    const evalPath = path.join(TEST_DIR, "empty-files-eval.json");
    fs.writeFileSync(
      evalPath,
      JSON.stringify({
        skill_name: "empty-files-skill",
        evals: [
          {
            id: 1,
            prompt: "Test prompt",
            expected_output: "Expected result",
            files: [],
            expectations: ["The output is correct"],
          },
        ],
      }),
    );

    const file: DetectedFile = {
      absolutePath: evalPath,
      relativePath: "empty-files-eval.json",
      type: "eval",
      format: "json",
    };

    const evalFile = parseEvalFile(file);

    expect(evalFile.tests[0].files).toBeDefined();
    expect(evalFile.tests[0].files).toEqual([]);
    expect(Array.isArray(evalFile.tests[0].files)).toBe(true);
  });

  it("uses id for name in Anthropic format even when name is also present", () => {
    const evalPath = path.join(TEST_DIR, "both-name-and-id.json");
    fs.writeFileSync(
      evalPath,
      JSON.stringify({
        skill_name: "test-skill",
        evals: [
          {
            id: 42,
            name: "custom-name",
            prompt: "test",
            expected_output: "result",
          },
        ],
      }),
    );

    const file: DetectedFile = {
      absolutePath: evalPath,
      relativePath: "both-name-and-id.json",
      type: "eval",
      format: "json",
    };

    const evalFile = parseEvalFile(file);

    // In Anthropic format, id takes precedence for the name
    expect(evalFile.tests[0].name).toBe("eval-42");
    expect(evalFile.tests[0].id).toBe(42);
  });

  it("handles Anthropic format with non-numeric id gracefully", () => {
    const evalPath = path.join(TEST_DIR, "string-id.json");
    fs.writeFileSync(
      evalPath,
      JSON.stringify({
        skill_name: "test-skill",
        evals: [
          {
            id: "custom-1",
            prompt: "test",
            expected_output: "result",
          },
        ],
      }),
    );

    const file: DetectedFile = {
      absolutePath: evalPath,
      relativePath: "string-id.json",
      type: "eval",
      format: "json",
    };

    const evalFile = parseEvalFile(file);

    // String id: name is derived from id, but id field is undefined (non-numeric)
    expect(evalFile.tests[0].name).toBe("eval-custom-1");
    expect(evalFile.tests[0].id).toBeUndefined();
  });

  it("returns empty tests array for Anthropic format with empty evals", () => {
    const evalPath = path.join(TEST_DIR, "empty-evals.json");
    fs.writeFileSync(
      evalPath,
      JSON.stringify({
        skill_name: "empty-skill",
        evals: [],
      }),
    );

    const file: DetectedFile = {
      absolutePath: evalPath,
      relativePath: "empty-evals.json",
      type: "eval",
      format: "json",
    };

    const evalFile = parseEvalFile(file);

    expect(evalFile.skillPath).toBe("empty-skill");
    expect(evalFile.tests).toEqual([]);
  });
});
