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

    expect(evals.length).toBe(1);
    expect(evals[0].skillDirName).toBe("code-review");
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
