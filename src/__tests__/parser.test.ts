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
});
