---
name: code-review
description: Reviews code changes for quality, security, and best practices. Activate when the user asks to review code, check a pull request, audit code quality, or evaluate changes.
---

# Code Review

When reviewing code, follow the progressive-disclosure workflow below. Do NOT read all reference files at once.

## References

| When the user mentions...       | Read                              |
|---------------------------------|-----------------------------------|
| Security concerns, vulnerabilities | `references/security-checklist.md` |
| General code quality, patterns    | `references/quality-patterns.md`   |

## Workflow

1. **Read the diff** — understand what changed and why
2. **Security scan** — check for OWASP top-10 vulnerabilities (load security reference if needed)
3. **Quality check** — look for code smells, complexity, naming (load quality reference if needed)
4. **Summarize** — produce a structured review

## Output Format

- **Summary**: Brief overview of the changes
- **Issues**: List by severity (critical, warning, info)
- **Suggestions**: Concrete improvement recommendations
- **Verdict**: approve, request changes, or comment

## Hard Rules

- Be constructive — suggest fixes, not just problems
- Reference line numbers
- Acknowledge good patterns when present
