import * as fs from "fs";
import * as path from "path";
import matter from "gray-matter";
import { parse as parseYaml } from "yaml";
import { getSkillReferences, type DetectedFile } from "./detector.js";
import type {
  EvalFile,
  EvalTestCase,
  GraderConfig,
  Skill,
  SkillMetadata,
  SkillReference,
} from "./types.js";

export function parseSkill(file: DetectedFile): Skill {
  const rawContent = fs.readFileSync(file.absolutePath, "utf-8");
  const references = loadReferences(file.absolutePath);
  const skillName =
    file.skillDirName ?? deriveSkillName(file.absolutePath, file.relativePath);

  switch (file.format) {
    case "markdown":
      return parseMarkdownSkill(file, rawContent, skillName, references);
    case "yaml":
      return parseYamlSkill(file, rawContent, skillName, references);
    case "json":
      return parseJsonSkill(file, rawContent, skillName, references);
  }
}

export function parseEvalFile(file: DetectedFile): EvalFile {
  const rawContent = fs.readFileSync(file.absolutePath, "utf-8");

  let parsed: unknown;
  if (file.format === "json") {
    parsed = JSON.parse(rawContent);
  } else {
    parsed = parseYaml(rawContent);
  }

  const obj = parsed as Record<string, unknown>;

  // Support Anthropic format: `evals` array key + `skill_name`
  const rawTests = (obj.tests ?? obj.test_cases ?? obj.evals ?? []) as Record<string, unknown>[];
  const skillPath = ((obj.skill ?? obj.skill_name ?? "") as string);

  // Detect Anthropic format: presence of `evals` key or entries with `id`/`expected_output`
  const isAnthropicFormat = "evals" in obj;

  return {
    filePath: file.absolutePath,
    skillPath,
    tests: rawTests.map((t) => normalizeTestCase(t, isAnthropicFormat)),
  };
}

function normalizeTestCase(
  t: Record<string, unknown>,
  isAnthropicFormat: boolean,
): EvalTestCase {
  const name = isAnthropicFormat && t.id != null
    ? `eval-${t.id}`
    : ((t.name as string) ?? "Unnamed test");

  const expected = ((t.expected ?? t.expected_output ?? "") as string);

  return {
    name,
    prompt: t.prompt as string,
    expected,
    id: typeof t.id === "number" ? t.id : undefined,
    files: Array.isArray(t.files) ? (t.files as string[]) : undefined,
    expectations: Array.isArray(t.expectations) ? (t.expectations as string[]) : undefined,
    match_pattern: t.match_pattern as string | undefined,
    required_keywords: t.required_keywords as string[] | undefined,
    forbidden_keywords: t.forbidden_keywords as string[] | undefined,
    max_tokens: t.max_tokens as number | undefined,
    graders: parseGraders(t.graders),
  };
}

function parseGraders(raw: unknown): GraderConfig[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;

  return raw.map((g: Record<string, unknown>) => ({
    type: (g.type as GraderConfig["type"]) ?? "hard_constraints",
    weight: typeof g.weight === "number" ? g.weight : 1.0,
    match_pattern: g.match_pattern as string | undefined,
    required_keywords: g.required_keywords as string[] | undefined,
    forbidden_keywords: g.forbidden_keywords as string[] | undefined,
    expected: g.expected as string | undefined,
    command: g.command as string | undefined,
  }));
}

function parseMarkdownSkill(
  file: DetectedFile,
  rawContent: string,
  skillName: string,
  references: SkillReference[],
): Skill {
  const { data, content } = matter(rawContent);
  const metadata = extractMetadata(data);

  return {
    filePath: file.absolutePath,
    relativePath: file.relativePath,
    skillName,
    format: "markdown",
    metadata,
    instructions: content.trim(),
    rawContent,
    references,
  };
}

function parseYamlSkill(
  file: DetectedFile,
  rawContent: string,
  skillName: string,
  references: SkillReference[],
): Skill {
  const parsed = parseYaml(rawContent) as Record<string, unknown>;
  const metadata = extractMetadata(parsed);
  const instructions = (
    (parsed.instructions ?? parsed.body ?? "") as string
  ).trim();

  return {
    filePath: file.absolutePath,
    relativePath: file.relativePath,
    skillName,
    format: "yaml",
    metadata,
    instructions,
    rawContent,
    references,
  };
}

function parseJsonSkill(
  file: DetectedFile,
  rawContent: string,
  skillName: string,
  references: SkillReference[],
): Skill {
  const parsed = JSON.parse(rawContent) as Record<string, unknown>;
  const metadata = extractMetadata(parsed);
  const instructions = (
    (parsed.instructions ?? parsed.body ?? "") as string
  ).trim();

  return {
    filePath: file.absolutePath,
    relativePath: file.relativePath,
    skillName,
    format: "json",
    metadata,
    instructions,
    rawContent,
    references,
  };
}

function extractMetadata(data: Record<string, unknown>): SkillMetadata {
  return {
    title: (data.title ?? data.name ?? "Untitled") as string,
    description: data.description as string | undefined,
    triggers: data.triggers as string[] | undefined,
    tags: data.tags as string[] | undefined,
    author: data.author as string | undefined,
    version: data.version as string | undefined,
    ...data,
  };
}

function loadReferences(skillFilePath: string): SkillReference[] {
  const refFiles = getSkillReferences(skillFilePath);

  return refFiles.map((ref) => {
    let content = "";
    try {
      content = fs.readFileSync(ref.filePath, "utf-8");
    } catch {
      // Binary or unreadable files - just track the path
    }

    return {
      name: ref.name,
      filePath: ref.filePath,
      content,
    };
  });
}

function deriveSkillName(absolutePath: string, relativePath: string): string {
  // For directory-based layout (skills/code-review/SKILL.md), use the directory name
  const dir = path.dirname(relativePath);
  if (dir && dir !== ".") {
    return path.basename(dir);
  }

  // For flat layout, use the filename without extension
  return path
    .basename(absolutePath)
    .replace(/\.(md|yml|yaml|json)$/i, "");
}
