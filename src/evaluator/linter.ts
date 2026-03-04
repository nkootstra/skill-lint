import type { Rubric } from "../config/schema.js";
import type { LLMProvider } from "../providers/types.js";
import type { LintIssue, Skill } from "../skills/types.js";

interface BuiltInRule {
  id: string;
  check: (skill: Skill) => boolean;
  severity: "error" | "warning" | "info";
  message: string;
  suggestion?: string;
  configKey?: string;
}

const BUILT_IN_RULES: BuiltInRule[] = [
  {
    id: "no-name",
    check: (skill) =>
      !skill.metadata.title || skill.metadata.title === "Untitled",
    severity: "error",
    message: "Skill is missing a name/title",
    suggestion: "Add a 'name' field in the YAML frontmatter",
  },
  {
    id: "no-description",
    check: (skill) => !skill.metadata.description?.trim(),
    severity: "error",
    message: "Skill is missing a description (used for trigger matching)",
    suggestion: "Add a 'description' field that explains when this skill should activate",
    configKey: "require_description",
  },
  {
    id: "empty-instructions",
    check: (skill) => !skill.instructions.trim(),
    severity: "error",
    message: "Skill has no instructions/body content",
    suggestion: "Add instructions describing the agent workflow",
  },
  {
    id: "too-short-instructions",
    check: (skill) => {
      const words = skill.instructions.trim().split(/\s+/);
      return words.length > 0 && words.length < 10;
    },
    severity: "warning",
    message: "Skill instructions are very short (fewer than 10 words)",
    suggestion: "Add more detail for better agent behavior",
  },
  {
    id: "no-examples",
    check: (skill) => {
      const text = skill.instructions.toLowerCase();
      return !(text.includes("example") || skill.instructions.includes("```") ||
        (skill.metadata as Record<string, unknown>).examples !== undefined);
    },
    severity: "info",
    message: "Skill does not include usage examples",
    suggestion: "Add examples showing expected usage and output",
    configKey: "require_examples",
  },
  {
    id: "missing-reference-table",
    check: (skill) => {
      if (skill.references.length === 0) return false;
      // Skills with references should have a routing table
      const hasTable = skill.instructions.includes("|") &&
        skill.instructions.toLowerCase().includes("reference");
      return !hasTable;
    },
    severity: "warning",
    message: "Skill has reference files but no routing table in instructions",
    suggestion: "Add a markdown table mapping user intents to reference files (progressive disclosure pattern)",
  },
  {
    id: "orphaned-references",
    check: (skill) => {
      if (skill.references.length === 0) return false;
      return skill.references.some(
        (ref) => !skill.instructions.includes(ref.name),
      );
    },
    severity: "info",
    message: "Some reference files are not mentioned in the skill instructions",
    suggestion: "Reference all files in the routing table so the agent knows when to load them",
  },
];

export async function lintSkill(
  skill: Skill,
  rubric: Rubric,
  provider?: LLMProvider,
): Promise<LintIssue[]> {
  const issues: LintIssue[] = [];

  // Built-in rules
  for (const rule of BUILT_IN_RULES) {
    if (rule.configKey && rubric[rule.configKey as keyof Rubric] === false) {
      continue;
    }
    if (rule.check(skill)) {
      issues.push({
        rule: rule.id,
        severity: rule.severity,
        message: rule.message,
        suggestion: rule.suggestion,
      });
    }
  }

  // Token budget check
  if (rubric.max_instruction_tokens) {
    const estimatedTokens = Math.ceil(skill.instructions.length / 4);
    if (estimatedTokens > rubric.max_instruction_tokens) {
      issues.push({
        rule: "max-instruction-tokens",
        severity: "warning",
        message: `Instructions estimated at ~${estimatedTokens} tokens (max: ${rubric.max_instruction_tokens})`,
        suggestion: "Condense instructions or move detail into reference files",
      });
    }
  }

  // Custom LLM-evaluated rules
  for (const rule of rubric.rules) {
    if (!rule.enabled) continue;
    const customPrompt = rubric.custom_prompts[rule.id];
    if (customPrompt && provider) {
      const llmIssues = await evaluateCustomRule(
        skill, rule.id, rule.description, customPrompt, rule.severity, provider,
      );
      issues.push(...llmIssues);
    }
  }

  return issues;
}

async function evaluateCustomRule(
  skill: Skill,
  ruleId: string,
  ruleDescription: string,
  prompt: string,
  severity: "error" | "warning" | "info",
  provider: LLMProvider,
): Promise<LintIssue[]> {
  const fullPrompt = `You are a skill quality evaluator. Evaluate the following skill against this rule:

Rule: ${ruleDescription}
Evaluation criteria: ${prompt}

Skill name: ${skill.metadata.title}
Skill description: ${skill.metadata.description ?? "N/A"}
Skill instructions:
${skill.instructions}
${skill.references.length > 0 ? `\nReference files: ${skill.references.map((r) => r.name).join(", ")}` : ""}

Respond in JSON format:
{
  "passes": true/false,
  "issues": [{ "message": "description of issue", "suggestion": "how to fix" }]
}

Only return JSON.`;

  try {
    const response = await provider.complete([
      { role: "user", content: fullPrompt },
    ]);

    const parsed = JSON.parse(response.content) as {
      passes: boolean;
      issues: Array<{ message: string; suggestion?: string }>;
    };

    if (!parsed.passes) {
      return (parsed.issues ?? []).map((issue) => ({
        rule: ruleId,
        severity,
        message: issue.message,
        suggestion: issue.suggestion,
      }));
    }
  } catch {
    return [{
      rule: ruleId,
      severity: "info",
      message: `Could not evaluate custom rule '${ruleId}': LLM evaluation failed`,
    }];
  }

  return [];
}
