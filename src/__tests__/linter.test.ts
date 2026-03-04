import { describe, expect, it } from "vitest";
import type { Rubric } from "../config/schema.js";
import { lintSkill } from "../evaluator/linter.js";
import type { Skill } from "../skills/types.js";

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    filePath: "/skills/test-skill/SKILL.md",
    relativePath: "test-skill/SKILL.md",
    skillName: "test-skill",
    format: "markdown",
    metadata: {
      title: "test-skill",
      description: "A test skill for unit tests",
    },
    instructions:
      "These are the test instructions for the skill. They contain enough words to pass the minimum length check.",
    rawContent: "---\nname: test-skill\n---\nInstructions here",
    references: [],
    ...overrides,
  };
}

const defaultRubric: Rubric = {
  rules: [],
  require_description: true,
  require_examples: false,
  require_triggers: true,
  max_instruction_tokens: undefined,
  custom_prompts: {},
};

describe("lintSkill", () => {
  it("passes a well-formed skill", async () => {
    const issues = await lintSkill(makeSkill(), defaultRubric);
    expect(issues).toHaveLength(0);
  });

  it("flags missing name", async () => {
    const skill = makeSkill({
      metadata: { title: "Untitled", description: "desc" },
    });
    const issues = await lintSkill(skill, defaultRubric);
    expect(issues.find((i) => i.rule === "no-name")).toBeDefined();
  });

  it("flags missing description", async () => {
    const skill = makeSkill({
      metadata: { title: "test", description: undefined },
    });
    const issues = await lintSkill(skill, defaultRubric);
    const issue = issues.find((i) => i.rule === "no-description");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("error");
  });

  it("flags empty instructions", async () => {
    const skill = makeSkill({ instructions: "" });
    const issues = await lintSkill(skill, defaultRubric);
    expect(issues.find((i) => i.rule === "empty-instructions")).toBeDefined();
  });

  it("flags very short instructions", async () => {
    const skill = makeSkill({ instructions: "Do the thing" });
    const issues = await lintSkill(skill, defaultRubric);
    expect(issues.find((i) => i.rule === "too-short-instructions")).toBeDefined();
  });

  it("flags exceeding max_instruction_tokens", async () => {
    const skill = makeSkill({ instructions: "word ".repeat(5000) });
    const rubric = { ...defaultRubric, max_instruction_tokens: 1000 };
    const issues = await lintSkill(skill, rubric);
    expect(issues.find((i) => i.rule === "max-instruction-tokens")).toBeDefined();
  });

  it("skips disabled rules via rubric config", async () => {
    const skill = makeSkill({
      metadata: { title: "test", description: undefined },
    });
    const rubric = { ...defaultRubric, require_description: false };
    const issues = await lintSkill(skill, rubric);
    expect(issues.find((i) => i.rule === "no-description")).toBeUndefined();
  });

  it("flags references without routing table", async () => {
    const skill = makeSkill({
      references: [
        { name: "guide.md", filePath: "/ref/guide.md", content: "# Guide" },
      ],
      instructions: "Just do the thing without any reference table.",
    });
    const issues = await lintSkill(skill, defaultRubric);
    expect(issues.find((i) => i.rule === "missing-reference-table")).toBeDefined();
  });

  it("passes when references have a routing table", async () => {
    const skill = makeSkill({
      references: [
        { name: "guide.md", filePath: "/ref/guide.md", content: "# Guide" },
      ],
      instructions:
        "## References\n\n| When the user mentions... | Read |\n|---|---|\n| Guidance | `references/guide.md` |",
    });
    const issues = await lintSkill(skill, defaultRubric);
    expect(issues.find((i) => i.rule === "missing-reference-table")).toBeUndefined();
  });

  it("flags orphaned references not mentioned in instructions", async () => {
    const skill = makeSkill({
      references: [
        { name: "guide.md", filePath: "/ref/guide.md", content: "# Guide" },
        { name: "hidden.md", filePath: "/ref/hidden.md", content: "# Hidden" },
      ],
      instructions:
        "## References\n\n| When | Read |\n|---|---|\n| Guidance | `references/guide.md` |",
    });
    const issues = await lintSkill(skill, defaultRubric);
    expect(issues.find((i) => i.rule === "orphaned-references")).toBeDefined();
  });
});
