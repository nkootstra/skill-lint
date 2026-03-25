import * as fs from "fs";
import * as path from "path";
import type { LintIssue, Skill } from "../skills/types.js";

interface SecurityFinding {
  line?: number;
  context?: string;
  source?: string;
}

interface SecurityRule {
  id: string;
  severity: "error" | "warning";
  message: string;
  suggestion: string;
  check: (skill: Skill) => SecurityFinding[];
}

function findPatternInContent(
  content: string,
  pattern: RegExp,
  source?: string,
): SecurityFinding[] {
  const lines = content.split("\n");
  const findings: SecurityFinding[] = [];
  for (let i = 0; i < lines.length; i++) {
    pattern.lastIndex = 0;
    if (pattern.test(lines[i])) {
      findings.push({
        line: i + 1,
        context: source
          ? `[${source}] ${lines[i].trim().substring(0, 100)}`
          : lines[i].trim().substring(0, 100),
        source,
      });
    }
  }
  return findings;
}

function scanAllContent(
  skill: Skill,
  pattern: RegExp,
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  findings.push(...findPatternInContent(skill.rawContent, pattern));
  for (const ref of skill.references) {
    findings.push(...findPatternInContent(ref.content, pattern, ref.name));
  }
  return findings;
}

const SECURITY_RULES: SecurityRule[] = [
  {
    id: "security-shell-exec",
    severity: "error",
    message: "Skill contains shell execution directive",
    suggestion:
      "Remove shell execution directives (! bash, ! sh, ! ./) — these can execute arbitrary code during skill loading",
    check: (skill) =>
      scanAllContent(skill, /!\s*(bash|sh|zsh|\.\/|\/bin\/|\/usr\/bin\/)/gi),
  },
  {
    id: "security-exfiltration",
    severity: "error",
    message: "Skill contains potential data exfiltration command",
    suggestion:
      "Remove curl/wget/fetch calls to external URLs — these can leak sensitive data to remote servers",
    check: (skill) => {
      const curlWget = scanAllContent(
        skill,
        /\b(curl|wget)\s+(-[a-zA-Z]*\s+)*https?:\/\//gi,
      );
      const fetch = scanAllContent(
        skill,
        /fetch\s*\(\s*['"`]https?:\/\//gi,
      );
      return [...curlWget, ...fetch];
    },
  },
  {
    id: "security-config-poison",
    severity: "error",
    message: "Skill attempts to modify agent configuration files",
    suggestion:
      "Do not write to CLAUDE.md, AGENTS.md, or .cursorrules — this is a memory/config poisoning attack vector",
    check: (skill) =>
      scanAllContent(
        skill,
        /(?:write|append|modify|create|overwrite|echo\s.*>>?|cat\s.*>>?)\s.*(?:CLAUDE\.md|AGENTS\.md|\.cursorrules|\.claude\/)/gi,
      ),
  },
  {
    id: "security-permission-bypass",
    severity: "error",
    message: "Skill instructs disabling security controls",
    suggestion:
      "Never disable permission checks or sandbox protections — these exist to prevent malicious code execution",
    check: (skill) =>
      scanAllContent(
        skill,
        /(--dangerously-skip-permissions|--no-verify|--trust-all|dangerouslyDisableSandbox|allowedTools:\s*\*)/gi,
      ),
  },
  {
    id: "security-sensitive-files",
    severity: "warning",
    message: "Skill references sensitive file paths",
    suggestion:
      "Avoid referencing SSH keys, AWS credentials, .env files, or other secrets — these could be exfiltrated",
    check: (skill) =>
      scanAllContent(
        skill,
        /(?:~\/\.ssh|~\/\.aws|~\/\.gnupg|\/etc\/passwd|\/etc\/shadow|\.env\b|credentials\.json|\.npmrc|\.pypirc|id_rsa)/gi,
      ),
  },
  {
    id: "security-symlink-escape",
    severity: "error",
    message: "Skill reference file is a symlink pointing outside the skill directory",
    suggestion:
      "Remove symlinks that escape the skill directory — these can expose sensitive files like SSH keys",
    check: (skill) => {
      const findings: SecurityFinding[] = [];
      const skillDir = path.dirname(skill.filePath);

      for (const ref of skill.references) {
        try {
          const stat = fsOps.lstatSync(ref.filePath);
          if (stat.isSymbolicLink()) {
            const resolved = fsOps.realpathSync(ref.filePath);
            const resolvedSkillDir = fsOps.realpathSync(skillDir);
            if (!resolved.startsWith(resolvedSkillDir + path.sep) && resolved !== resolvedSkillDir) {
              findings.push({
                context: `Symlink ${ref.name} -> ${resolved}`,
                source: ref.name,
              });
            }
          }
        } catch {
          // File doesn't exist or can't be read — skip
        }
      }
      return findings;
    },
  },
  {
    id: "security-encoded-payload",
    severity: "warning",
    message: "Skill contains a suspiciously long encoded string",
    suggestion:
      "Long base64 strings can hide malicious payloads — decode and review, or remove if unnecessary",
    check: (skill) => {
      const base64Long = scanAllContent(
        skill,
        /[A-Za-z0-9+/]{100,}={0,2}/g,
      );
      const base64Decode = scanAllContent(
        skill,
        /(?:atob\s*\(|Buffer\.from\s*\(.*['"]base64['"]|base64\s+-d)/gi,
      );
      return [...base64Long, ...base64Decode];
    },
  },
  {
    id: "security-suspicious-install",
    severity: "warning",
    message: "Skill contains package installation commands",
    suggestion:
      "Package install commands can execute arbitrary code via postinstall hooks — review dependencies carefully",
    check: (skill) =>
      scanAllContent(
        skill,
        /\b(npm\s+install|pip\s+install|yarn\s+add|postinstall|preinstall)\b/gi,
      ),
  },
];

/** Filesystem operations, extracted for testability. */
export const fsOps = {
  lstatSync: (p: string) => fs.lstatSync(p),
  realpathSync: (p: string) => fs.realpathSync(p),
};

/**
 * Scans a skill for security issues based on known attack patterns
 * from the "Dangerous Skills" research.
 *
 * Returns findings as LintIssue[] with "security-" prefixed rule IDs.
 */
export function scanSkillSecurity(skill: Skill): LintIssue[] {
  const issues: LintIssue[] = [];

  for (const rule of SECURITY_RULES) {
    const findings = rule.check(skill);
    for (const finding of findings) {
      issues.push({
        rule: rule.id,
        severity: rule.severity,
        message: finding.context
          ? `${rule.message}: ${finding.context}`
          : rule.message,
        line: finding.line,
        suggestion: rule.suggestion,
      });
    }
  }

  return issues;
}
