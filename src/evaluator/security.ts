import fs from "node:fs";
import path from "node:path";
import type { LintIssue, Skill } from "../skills/types.js";

interface SecurityRule {
  id: string;
  severity: "error" | "warning";
  description: string;
  /** Line-by-line regex check against text content */
  pattern?: RegExp;
  /** Custom check function for rules needing more than a single regex */
  check?: (skill: Skill) => LintIssue[];
}

// ---------------------------------------------------------------------------
// Pattern helpers
// ---------------------------------------------------------------------------

const SHELL_EXEC_PATTERN = /^\s*!\s*(bash|sh|\.\/|\/bin\/)/i;

const EXFILTRATION_PATTERN =
  /\b(curl|wget)\b.*https?:\/\/|fetch\s*\(\s*['"`]https?:\/\//i;

const PERMISSION_BYPASS_PATTERN =
  /--dangerously-skip-permissions|dangerouslyDisableSandbox/;

const SENSITIVE_FILES_PATTERN =
  /~\/\.ssh\/|~\/\.aws\/|\.env\b|credentials\.json\b|id_rsa\b|\.npmrc\b|\.netrc\b/i;

const ENCODED_PAYLOAD_PATTERN = /[A-Za-z0-9+/=]{100,}/;

const SUSPICIOUS_INSTALL_PATTERN =
  /\bnpm\s+install\b|\bpip\s+install\b|\bpostinstall\b|\bpreinstall\b/i;

// Config-poison: a line must contain both a write-like operator AND a config path
const CONFIG_PATHS = [
  /~\/\.claude\/CLAUDE\.md/,
  /AGENTS\.md/,
  /\.cursorrules/,
  /~\/\.claude\/settings/,
  /memory\.json/,
];

const WRITE_OPERATORS = [/>>/, />/, /\btee\b/, /\becho\b.*>/, /\bcat\b.*>/, /\bwrite\b/i];

// ---------------------------------------------------------------------------
// Scanning helpers
// ---------------------------------------------------------------------------

function scanLines(
  content: string,
  pattern: RegExp,
  rule: SecurityRule,
  source: string,
): LintIssue[] {
  const issues: LintIssue[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      issues.push({
        rule: rule.id,
        severity: rule.severity,
        message: `${rule.description} (${source}, line ${i + 1})`,
        line: i + 1,
        suggestion: `Review this line for potential security risks`,
      });
    }
  }

  return issues;
}

function scanContent(
  content: string,
  rule: SecurityRule,
  source: string,
): LintIssue[] {
  if (!rule.pattern) return [];
  return scanLines(content, rule.pattern, rule, source);
}

// ---------------------------------------------------------------------------
// Custom rule checks
// ---------------------------------------------------------------------------

function checkConfigPoison(skill: Skill): LintIssue[] {
  const issues: LintIssue[] = [];

  const scan = (content: string, source: string) => {
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const hasConfigPath = CONFIG_PATHS.some((p) => p.test(line));
      const hasWriteOp = WRITE_OPERATORS.some((p) => p.test(line));
      if (hasConfigPath && hasWriteOp) {
        issues.push({
          rule: "security-config-poison",
          severity: "error",
          message: `Potential config/memory poisoning: writes to agent config file (${source}, line ${i + 1})`,
          line: i + 1,
          suggestion: "Skills should not modify global agent config or memory files",
        });
      }
    }
  };

  scan(skill.rawContent, "skill");
  for (const ref of skill.references) {
    scan(ref.content, ref.name);
  }

  return issues;
}

function checkSymlinkEscape(skill: Skill): LintIssue[] {
  const issues: LintIssue[] = [];
  const skillDir = path.dirname(skill.filePath);

  for (const ref of skill.references) {
    try {
      const stat = fs.lstatSync(ref.filePath);
      if (stat.isSymbolicLink()) {
        const realPath = fs.realpathSync(ref.filePath);
        const relative = path.relative(skillDir, realPath);
        if (relative.startsWith("..")) {
          issues.push({
            rule: "security-symlink-escape",
            severity: "error",
            message: `Reference file "${ref.name}" is a symlink pointing outside the skill directory (resolves to ${realPath})`,
            suggestion: "Remove symlinks that point outside the skill directory; they can be used to exfiltrate sensitive files",
          });
        }
      }
    } catch {
      // File may not exist on disk (e.g. in tests) -- skip silently
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Rule definitions
// ---------------------------------------------------------------------------

const SECURITY_RULES: SecurityRule[] = [
  {
    id: "security-shell-exec",
    severity: "error",
    description: "Shell execution directive detected (! bash/sh)",
    pattern: SHELL_EXEC_PATTERN,
  },
  {
    id: "security-exfiltration",
    severity: "error",
    description: "Potential data exfiltration via curl/wget/fetch to external URL",
    pattern: EXFILTRATION_PATTERN,
  },
  {
    id: "security-config-poison",
    severity: "error",
    description: "Config/memory poisoning",
    check: checkConfigPoison,
  },
  {
    id: "security-permission-bypass",
    severity: "error",
    description: "Permission/safety bypass flag detected",
    pattern: PERMISSION_BYPASS_PATTERN,
  },
  {
    id: "security-sensitive-files",
    severity: "warning",
    description: "Reference to sensitive file or directory",
    pattern: SENSITIVE_FILES_PATTERN,
  },
  {
    id: "security-symlink-escape",
    severity: "error",
    description: "Symlink escape",
    check: checkSymlinkEscape,
  },
  {
    id: "security-encoded-payload",
    severity: "warning",
    description: "Suspiciously long base64-encoded string detected",
    pattern: ENCODED_PAYLOAD_PATTERN,
  },
  {
    id: "security-suspicious-install",
    severity: "warning",
    description: "Package install command or lifecycle hook detected",
    pattern: SUSPICIOUS_INSTALL_PATTERN,
  },
];

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Scan a skill for security issues. Returns LintIssue[] with "security-"
 * prefixed rule IDs so they integrate with the existing lint pipeline.
 */
export function scanSkillSecurity(skill: Skill): LintIssue[] {
  const issues: LintIssue[] = [];

  for (const rule of SECURITY_RULES) {
    if (rule.check) {
      issues.push(...rule.check(skill));
      continue;
    }

    // Pattern-based rules: scan rawContent + reference contents
    issues.push(...scanContent(skill.rawContent, rule, "skill"));
    for (const ref of skill.references) {
      issues.push(...scanContent(ref.content, rule, ref.name));
    }
  }

  // Deduplicate by rule + line + message
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.rule}:${issue.line ?? ""}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
