import * as fs from "fs";
import * as path from "path";
import * as core from "@actions/core";

export interface DetectedFile {
  absolutePath: string;
  relativePath: string;
  type: "skill" | "eval";
  format: "markdown" | "yaml" | "json";
  /** The skill directory name (for directory-based layout) */
  skillDirName?: string;
}

const SKILL_EXTENSIONS: Record<string, "markdown" | "yaml" | "json"> = {
  ".md": "markdown",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".json": "json",
};

const EVAL_PATTERNS = [".eval.yml", ".eval.yaml", ".eval.json"];

/**
 * Detects skill files supporting two layouts:
 *
 * 1. Directory-based (default): skills/{skill-name}/SKILL.md
 *    with optional references/ subdirectory and co-located SKILL.eval.yml
 *
 * 2. Flat: skills/my-skill.md with co-located my-skill.eval.yml
 */
export function detectSkillFiles(
  skillsDir: string,
  changedFiles?: string[],
): DetectedFile[] {
  const absoluteDir = path.resolve(skillsDir);

  if (!fs.existsSync(absoluteDir)) {
    core.warning(`Skills directory not found: ${absoluteDir}`);
    return [];
  }

  const detected: DetectedFile[] = [];

  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(absoluteDir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "references") {
        continue;
      }
      // Check for directory-based layout: skills/{name}/SKILL.md
      detectInSkillDirectory(absoluteDir, fullPath, entry.name, detected);
    } else if (entry.isFile()) {
      // Check for flat layout: skills/my-skill.md
      detectFlatFile(absoluteDir, fullPath, detected);
    }
  }

  // If changedFiles provided, filter to only changed skills (and their evals)
  if (changedFiles && changedFiles.length > 0) {
    const changedSet = new Set(changedFiles.map((f) => path.resolve(f)));

    // Also consider changed files inside skill directories (e.g., references/)
    const changedSkillDirs = new Set<string>();
    for (const f of changedFiles) {
      const abs = path.resolve(f);
      if (abs.startsWith(absoluteDir)) {
        const rel = path.relative(absoluteDir, abs);
        const parts = rel.split(path.sep);
        if (parts.length > 1) {
          changedSkillDirs.add(parts[0]);
        }
      }
    }

    const changedSkills = detected.filter(
      (f) =>
        f.type === "skill" &&
        (changedSet.has(f.absolutePath) ||
          (f.skillDirName && changedSkillDirs.has(f.skillDirName))),
    );

    const changedSkillBases = new Set(
      changedSkills.map((f) => f.skillDirName ?? getSkillBaseName(f.absolutePath)),
    );

    const relevantEvals = detected.filter(
      (f) =>
        f.type === "eval" &&
        changedSkillBases.has(f.skillDirName ?? getSkillBaseName(f.absolutePath)),
    );

    return [...changedSkills, ...relevantEvals];
  }

  return detected;
}

function detectInSkillDirectory(
  rootDir: string,
  dirPath: string,
  dirName: string,
  detected: DetectedFile[],
): void {
  const dirEntries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of dirEntries) {
    if (!entry.isFile()) continue;

    const fullPath = path.join(dirPath, entry.name);
    const relPath = path.relative(rootDir, fullPath);
    const ext = path.extname(entry.name).toLowerCase();

    // Check if it's an eval file
    const isEval = EVAL_PATTERNS.some((pattern) =>
      entry.name.toLowerCase().endsWith(pattern),
    );

    if (isEval) {
      detected.push({
        absolutePath: fullPath,
        relativePath: relPath,
        type: "eval",
        format: ext === ".json" ? "json" : "yaml",
        skillDirName: dirName,
      });
      continue;
    }

    // Check if it's a skill file
    const format = SKILL_EXTENSIONS[ext];
    if (format) {
      detected.push({
        absolutePath: fullPath,
        relativePath: relPath,
        type: "skill",
        format,
        skillDirName: dirName,
      });
    }
  }
}

function detectFlatFile(
  rootDir: string,
  filePath: string,
  detected: DetectedFile[],
): void {
  const relPath = path.relative(rootDir, filePath);
  const ext = path.extname(filePath).toLowerCase();

  const isEval = EVAL_PATTERNS.some((pattern) =>
    filePath.toLowerCase().endsWith(pattern),
  );

  if (isEval) {
    detected.push({
      absolutePath: filePath,
      relativePath: relPath,
      type: "eval",
      format: ext === ".json" ? "json" : "yaml",
    });
    return;
  }

  const format = SKILL_EXTENSIONS[ext];
  if (format) {
    detected.push({
      absolutePath: filePath,
      relativePath: relPath,
      type: "skill",
      format,
    });
  }
}

/**
 * Given a list of changed file paths from the PR, return those
 * that fall within the skills directory.
 */
export function filterChangedSkillFiles(
  changedFiles: string[],
  skillsDir: string,
): string[] {
  const absoluteDir = path.resolve(skillsDir);
  return changedFiles.filter((f) => {
    const abs = path.resolve(f);
    return abs.startsWith(absoluteDir);
  });
}

/**
 * Pair skill files with their co-located eval files.
 */
export function pairSkillsWithEvals(
  files: DetectedFile[],
): Map<DetectedFile, DetectedFile | null> {
  const skills = files.filter((f) => f.type === "skill");
  const evals = files.filter((f) => f.type === "eval");

  const evalMap = new Map<string, DetectedFile>();
  for (const evalFile of evals) {
    const key = evalFile.skillDirName ?? getSkillBaseName(evalFile.absolutePath);
    evalMap.set(key, evalFile);
  }

  const pairs = new Map<DetectedFile, DetectedFile | null>();
  for (const skill of skills) {
    const key = skill.skillDirName ?? getSkillBaseName(skill.absolutePath);
    pairs.set(skill, evalMap.get(key) ?? null);
  }

  return pairs;
}

/**
 * Get reference files from a skill's references/ subdirectory.
 */
export function getSkillReferences(
  skillFilePath: string,
): { name: string; filePath: string }[] {
  const skillDir = path.dirname(skillFilePath);
  const refsDir = path.join(skillDir, "references");

  if (!fs.existsSync(refsDir) || !fs.statSync(refsDir).isDirectory()) {
    return [];
  }

  const entries = fs.readdirSync(refsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => ({
      name: e.name,
      filePath: path.join(refsDir, e.name),
    }));
}

function getSkillBaseName(filePath: string): string {
  const base = path.basename(filePath);
  return base
    .replace(/\.eval\.(yml|yaml|json)$/i, "")
    .replace(/\.(md|yml|yaml|json)$/i, "");
}
