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
});
