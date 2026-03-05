import * as fs from "fs";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  detectSkillFiles,
  filterChangedSkillFiles,
  getSkillReferences,
  pairSkillsWithEvals,
} from "../skills/detector.js";

const TEST_DIR = path.join(process.cwd(), "__test_detect_fixtures__");

beforeAll(() => {
  // Directory-based layout: skills/{name}/SKILL.md
  fs.mkdirSync(path.join(TEST_DIR, "code-review", "references"), { recursive: true });
  fs.writeFileSync(path.join(TEST_DIR, "code-review", "SKILL.md"), "# Code Review");
  fs.writeFileSync(path.join(TEST_DIR, "code-review", "SKILL.eval.yml"), "tests: []");
  fs.writeFileSync(path.join(TEST_DIR, "code-review", "references", "style-guide.md"), "# Style Guide");
  fs.writeFileSync(path.join(TEST_DIR, "code-review", "references", "examples.md"), "# Examples");

  // Another directory-based skill without evals
  fs.mkdirSync(path.join(TEST_DIR, "testing"), { recursive: true });
  fs.writeFileSync(path.join(TEST_DIR, "testing", "SKILL.md"), "# Testing");

  // Skill with Anthropic-style evals/ subdirectory
  fs.mkdirSync(path.join(TEST_DIR, "anthropic-skill", "evals"), { recursive: true });
  fs.writeFileSync(path.join(TEST_DIR, "anthropic-skill", "SKILL.md"), "# Anthropic Skill");
  fs.writeFileSync(
    path.join(TEST_DIR, "anthropic-skill", "evals", "evals.json"),
    JSON.stringify({ skill_name: "anthropic-skill", evals: [] }),
  );

  // Skill with evals/ subdirectory using YAML format
  fs.mkdirSync(path.join(TEST_DIR, "yaml-evals-skill", "evals"), { recursive: true });
  fs.writeFileSync(path.join(TEST_DIR, "yaml-evals-skill", "SKILL.md"), "# YAML Evals Skill");
  fs.writeFileSync(
    path.join(TEST_DIR, "yaml-evals-skill", "evals", "evals.yaml"),
    "skill: yaml-evals-skill\ntests: []",
  );

  // Skill with evals.json directly in the skill directory (zig-best-practices layout)
  fs.mkdirSync(path.join(TEST_DIR, "zig-best-practices"), { recursive: true });
  fs.writeFileSync(path.join(TEST_DIR, "zig-best-practices", "SKILL.md"), "# Zig Best Practices");
  fs.writeFileSync(
    path.join(TEST_DIR, "zig-best-practices", "evals.json"),
    JSON.stringify({
      skill_name: "zig-best-practices",
      evals: [{ id: 1, prompt: "test", expected_output: "result", files: [] }],
    }),
  );

  // Skill with BOTH SKILL.eval.yml AND evals.json (both formats)
  fs.mkdirSync(path.join(TEST_DIR, "dual-eval-skill"), { recursive: true });
  fs.writeFileSync(path.join(TEST_DIR, "dual-eval-skill", "SKILL.md"), "# Dual Eval Skill");
  fs.writeFileSync(path.join(TEST_DIR, "dual-eval-skill", "SKILL.eval.yml"), "skill: dual-eval-skill\ntests: []");
  fs.writeFileSync(
    path.join(TEST_DIR, "dual-eval-skill", "evals.json"),
    JSON.stringify({ skill_name: "dual-eval-skill", evals: [] }),
  );

  // Flat layout: skills/my-skill.yml at root level
  fs.writeFileSync(path.join(TEST_DIR, "flat-skill.yml"), "title: Flat");
  fs.writeFileSync(path.join(TEST_DIR, "not-a-skill.txt"), "hello");
});

afterAll(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("detectSkillFiles", () => {
  it("detects skills in directory-based layout", () => {
    const files = detectSkillFiles(TEST_DIR);
    const skills = files.filter((f) => f.type === "skill");
    const codeReview = skills.find((s) => s.skillDirName === "code-review");

    expect(codeReview).toBeDefined();
    expect(codeReview!.relativePath).toBe(path.join("code-review", "SKILL.md"));
  });

  it("detects skills in flat layout", () => {
    const files = detectSkillFiles(TEST_DIR);
    const flat = files.find((f) => f.relativePath === "flat-skill.yml");

    expect(flat).toBeDefined();
    expect(flat!.type).toBe("skill");
  });

  it("detects eval files co-located with directory-based skills", () => {
    const files = detectSkillFiles(TEST_DIR);
    const evals = files.filter((f) => f.type === "eval");

    expect(evals.length).toBe(6);
    const codeReviewEval = evals.find((e) => e.skillDirName === "code-review");
    expect(codeReviewEval).toBeDefined();
  });

  it("ignores non-skill files", () => {
    const files = detectSkillFiles(TEST_DIR);
    const txt = files.find((f) => f.absolutePath.endsWith(".txt"));

    expect(txt).toBeUndefined();
  });

  it("does not descend into references/ directory", () => {
    const files = detectSkillFiles(TEST_DIR);
    const refFile = files.find((f) => f.absolutePath.includes("references"));

    expect(refFile).toBeUndefined();
  });

  it("filters to changed files when provided", () => {
    const changedFiles = [path.join(TEST_DIR, "code-review", "SKILL.md")];
    const files = detectSkillFiles(TEST_DIR, changedFiles);
    const skills = files.filter((f) => f.type === "skill");

    expect(skills.length).toBe(1);
    expect(skills[0].skillDirName).toBe("code-review");
  });

  it("includes evals when skill is changed", () => {
    const changedFiles = [path.join(TEST_DIR, "code-review", "SKILL.md")];
    const files = detectSkillFiles(TEST_DIR, changedFiles);
    const evals = files.filter((f) => f.type === "eval");

    expect(evals.length).toBe(1);
  });

  it("triggers on reference file changes", () => {
    const changedFiles = [
      path.join(TEST_DIR, "code-review", "references", "style-guide.md"),
    ];
    const files = detectSkillFiles(TEST_DIR, changedFiles);
    const skills = files.filter((f) => f.type === "skill");

    expect(skills.length).toBe(1);
    expect(skills[0].skillDirName).toBe("code-review");
  });

  it("returns empty for non-existent directory", () => {
    expect(detectSkillFiles("/nonexistent/path")).toHaveLength(0);
  });

  it("detects eval files in evals/ subdirectory (Anthropic format)", () => {
    const files = detectSkillFiles(TEST_DIR);
    const evalFile = files.find(
      (f) => f.type === "eval" && f.absolutePath.includes(path.join("anthropic-skill", "evals")),
    );

    expect(evalFile).toBeDefined();
    expect(evalFile!.skillDirName).toBe("anthropic-skill");
    expect(evalFile!.format).toBe("json");
  });

  it("detects evals.yaml in evals/ subdirectory", () => {
    const files = detectSkillFiles(TEST_DIR);
    const evalFile = files.find(
      (f) => f.type === "eval" && f.absolutePath.includes(path.join("yaml-evals-skill", "evals")),
    );

    expect(evalFile).toBeDefined();
    expect(evalFile!.skillDirName).toBe("yaml-evals-skill");
    expect(evalFile!.format).toBe("yaml");
  });

  it("does not treat top-level evals/ directory as a skill directory", () => {
    // Create a top-level evals/ directory that should be skipped
    fs.mkdirSync(path.join(TEST_DIR, "evals"), { recursive: true });
    fs.writeFileSync(path.join(TEST_DIR, "evals", "SKILL.md"), "# Should be ignored");

    try {
      const files = detectSkillFiles(TEST_DIR);
      const fromTopEvals = files.find((f) => f.absolutePath.includes(path.join(TEST_DIR, "evals", "SKILL.md")));
      expect(fromTopEvals).toBeUndefined();
    } finally {
      fs.rmSync(path.join(TEST_DIR, "evals"), { recursive: true, force: true });
    }
  });

  it("triggers on changed files inside evals/ subdirectory", () => {
    const changedFiles = [
      path.join(TEST_DIR, "anthropic-skill", "evals", "evals.json"),
    ];
    const files = detectSkillFiles(TEST_DIR, changedFiles);
    const skills = files.filter((f) => f.type === "skill");

    expect(skills.length).toBe(1);
    expect(skills[0].skillDirName).toBe("anthropic-skill");
  });

  it("detects evals.json directly in skill directory as eval (not skill)", () => {
    const files = detectSkillFiles(TEST_DIR);
    const evalFile = files.find(
      (f) => f.type === "eval" && f.skillDirName === "zig-best-practices",
    );

    expect(evalFile).toBeDefined();
    expect(evalFile!.format).toBe("json");
    expect(evalFile!.relativePath).toBe(path.join("zig-best-practices", "evals.json"));

    // It must NOT appear as a skill file
    const asSkill = files.find(
      (f) =>
        f.type === "skill" &&
        f.absolutePath.includes(path.join("zig-best-practices", "evals.json")),
    );
    expect(asSkill).toBeUndefined();
  });

  it("detects both SKILL.eval.yml and evals.json in the same skill directory", () => {
    const files = detectSkillFiles(TEST_DIR);
    const dualEvals = files.filter(
      (f) => f.type === "eval" && f.skillDirName === "dual-eval-skill",
    );

    expect(dualEvals).toHaveLength(2);
    const formats = dualEvals.map((e) => e.format).sort();
    expect(formats).toEqual(["json", "yaml"]);
  });
});

describe("pairSkillsWithEvals", () => {
  it("pairs directory-based skills with their evals", () => {
    const files = detectSkillFiles(TEST_DIR);
    const pairs = pairSkillsWithEvals(files);

    const codeReview = [...pairs.entries()].find(
      ([s]) => s.skillDirName === "code-review",
    );
    expect(codeReview).toBeDefined();
    expect(codeReview![1]).not.toBeNull();
  });

  it("returns null for skills without evals", () => {
    const files = detectSkillFiles(TEST_DIR);
    const pairs = pairSkillsWithEvals(files);

    const testing = [...pairs.entries()].find(
      ([s]) => s.skillDirName === "testing",
    );
    expect(testing).toBeDefined();
    expect(testing![1]).toBeNull();
  });

  it("pairs skills with evals from evals/ subdirectory", () => {
    const files = detectSkillFiles(TEST_DIR);
    const pairs = pairSkillsWithEvals(files);

    const anthropicSkill = [...pairs.entries()].find(
      ([s]) => s.skillDirName === "anthropic-skill",
    );
    expect(anthropicSkill).toBeDefined();
    expect(anthropicSkill![1]).not.toBeNull();
    expect(anthropicSkill![1]!.absolutePath).toContain(path.join("evals", "evals.json"));
  });

  it("pairs skills with direct evals.json in skill directory", () => {
    const files = detectSkillFiles(TEST_DIR);
    const pairs = pairSkillsWithEvals(files);

    const zigSkill = [...pairs.entries()].find(
      ([s]) => s.skillDirName === "zig-best-practices",
    );
    expect(zigSkill).toBeDefined();
    expect(zigSkill![1]).not.toBeNull();
    expect(zigSkill![1]!.type).toBe("eval");
    expect(zigSkill![1]!.relativePath).toBe(path.join("zig-best-practices", "evals.json"));
  });

  it("pairs skill with one eval when both SKILL.eval.yml and evals.json exist (last-write-wins)", () => {
    const files = detectSkillFiles(TEST_DIR);
    const pairs = pairSkillsWithEvals(files);

    const dualSkill = [...pairs.entries()].find(
      ([s]) => s.skillDirName === "dual-eval-skill",
    );
    expect(dualSkill).toBeDefined();
    // Only one eval is paired (last one in the evalMap wins)
    expect(dualSkill![1]).not.toBeNull();
    expect(dualSkill![1]!.type).toBe("eval");
    expect(dualSkill![1]!.skillDirName).toBe("dual-eval-skill");
  });
});

describe("getSkillReferences", () => {
  it("lists reference files from references/ subdirectory", () => {
    const skillPath = path.join(TEST_DIR, "code-review", "SKILL.md");
    const refs = getSkillReferences(skillPath);

    expect(refs.length).toBe(2);
    const names = refs.map((r) => r.name).sort();
    expect(names).toEqual(["examples.md", "style-guide.md"]);
  });

  it("returns empty when no references/ directory exists", () => {
    const skillPath = path.join(TEST_DIR, "testing", "SKILL.md");
    const refs = getSkillReferences(skillPath);

    expect(refs).toHaveLength(0);
  });
});

describe("filterChangedSkillFiles", () => {
  it("filters files within skills directory", () => {
    const changed = [
      path.join(TEST_DIR, "code-review", "SKILL.md"),
      "/some/other/file.ts",
    ];
    const filtered = filterChangedSkillFiles(changed, TEST_DIR);

    expect(filtered).toHaveLength(1);
  });
});
