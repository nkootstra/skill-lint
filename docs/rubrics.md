# Custom Rubrics

Rubrics control what the linter checks for. Configure them in `.skill-lint.yml`.

## Built-in Rules

| Rule | Default | Severity | What it checks |
|------|---------|----------|----------------|
| `require_description` | `true` | error | Skill has a `description` in frontmatter |
| `require_examples` | `false` | info | Skill includes usage examples |
| `require_triggers` | `true` | warning | Skill has trigger conditions |
| `max_instruction_tokens` | none | warning | Instructions stay within token budget |

Additionally, these rules always run:
- **no-name** — Skill must have a name/title
- **empty-instructions** — Skill must have body content
- **too-short-instructions** — Flags instructions under 10 words
- **missing-reference-table** — Skills with reference files should have a routing table
- **orphaned-references** — All reference files should be mentioned in instructions

## Custom LLM-Evaluated Rules

You can define custom rules that are evaluated by the LLM:

```yaml
# .skill-lint.yml
rubric:
  rules:
    - id: clear-instructions
      description: "Instructions should be clear and unambiguous"
      severity: warning
      enabled: true

    - id: no-conflicting-rules
      description: "Instructions should not contain contradictory directives"
      severity: error
      enabled: true

  custom_prompts:
    clear-instructions: >
      Check if the skill instructions are clear, specific, and unambiguous.
      Look for vague language or missing context.
    no-conflicting-rules: >
      Check if any instructions contradict each other.
```

Each custom rule:
1. Gets the skill content + your prompt
2. Asks the LLM to evaluate
3. Reports issues with the severity you defined

## Disabling Rules

```yaml
rubric:
  require_description: false  # disables the description check
  require_examples: false     # already disabled by default
```

## Token Budget

Set a maximum instruction length to encourage lean, focused skills:

```yaml
rubric:
  max_instruction_tokens: 2000
```

This uses a simple `length / 4` estimate. Skills exceeding the budget get a warning suggesting they move detail into reference files.
