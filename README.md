# Skill Eval

A GitHub Action that evaluates, benchmarks, and refines agent skills on pull requests.

When you add or update skill files in a PR, Skill Eval runs a full evaluation pipeline — lint, eval, A/B compare, benchmark, and auto-suggest — then posts results as a PR comment and check status.

## Quick Start

Add this workflow to your repository:

```yaml
# .github/workflows/skill-eval.yml
name: Skill Eval

on:
  pull_request:
    paths:
      - "skills/**"
      - ".skill-eval.yml"

permissions:
  contents: read
  pull-requests: write
  checks: write

jobs:
  lint-skills:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: nkootstra/skill-eval@main
        with:
          provider: anthropic
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Skill Directory Structure

Skill Eval expects skills in this layout:

```
skills/
  code-review/
    SKILL.md              # Skill definition (frontmatter + instructions)
    evals.json            # Evaluation test cases (recommended)
    references/           # Reference files loaded on demand
      security-checklist.md
      quality-patterns.md
  another-skill/
    SKILL.md
    evals/
      evals.json          # Also supported: evals/ subdirectory
  legacy-skill/
    SKILL.md
    SKILL.eval.yml        # Alternative: co-located YAML eval file
```

### SKILL.md format

```markdown
---
name: code-review
description: Reviews code changes for quality and security
---

# Code Review

## References

| When the user mentions... | Read |
|---|---|
| Security concerns | `references/security-checklist.md` |

## Workflow

1. Read the diff
2. Security scan
3. Quality check
4. Summarize
```

### SKILL.eval.yml format

```yaml
skill: code-review

tests:
  - name: Detects SQL injection
    prompt: "Review this code: ..."
    expected: Should identify SQL injection
    required_keywords:
      - "SQL injection"
    forbidden_keywords:
      - "looks good"
```

## LLM Providers

See [docs/providers.md](docs/providers.md) for detailed setup instructions.

| Provider | Config | Auth |
|----------|--------|------|
| **Anthropic** | `provider: anthropic` | API key via `ANTHROPIC_API_KEY` secret |
| **OpenAI** | `provider: openai` | API key via `OPENAI_API_KEY` secret |
| **Claude Code** | `provider: claude-code` | OAuth token via `CLAUDE_CODE_OAUTH_TOKEN` secret (Pro/Max subscription) |
| **LiteLLM** | `provider: litellm` | Custom proxy with any model |

## Configuration

Create `.skill-eval.yml` in your repo root. See [.skill-eval.yml.example](.skill-eval.yml.example) for full reference.

## Pipeline

Each skill goes through 5 steps:

1. **Lint** — Static analysis (name, description, routing table, orphaned references)
2. **Eval** — Run test cases against the LLM with hard constraints + LLM-as-judge
3. **Benchmark** — Compute pass rate, token usage, and latency
4. **A/B Compare** — Compare head vs base branch performance
5. **Suggest** — Generate improvement recommendations

## Docs

- [Installation & Deployment](docs/installation.md)
- [Provider Setup](docs/providers.md)
- [Writing Evals](docs/evals.md)
- [Custom Rubrics](docs/rubrics.md)
- [Publishing to Marketplace](docs/publishing.md)

## License

MIT
