# Writing Evals

Evals are test cases that verify your skill works correctly. They're co-located with skills as `SKILL.eval.yml`.

## File Format

```yaml
skill: my-skill

tests:
  - name: Descriptive test name
    prompt: "The user input to test"
    expected: "Description of expected behavior"
    required_keywords:      # optional
      - "must contain this"
    forbidden_keywords:     # optional
      - "must not contain this"
    match_pattern: "regex"  # optional
    max_tokens: 1000        # optional
```

## How Evaluation Works

Each test case goes through two stages:

### Stage 1: Hard Constraints (no LLM needed)

If you specify `required_keywords`, `forbidden_keywords`, or `match_pattern`, these are checked first. If any hard constraint fails, the test fails immediately without needing an LLM judge call.

### Stage 2: LLM-as-Judge

If hard constraints pass (or none are defined), the LLM evaluates whether the response meets the `expected` behavior. It returns a pass/fail, a 0-1 score, and reasoning.

## Test Case Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Human-readable test description |
| `prompt` | Yes | The input sent to the skill |
| `expected` | Yes | What the response should do (natural language) |
| `required_keywords` | No | Words that must appear in the response (case-insensitive) |
| `forbidden_keywords` | No | Words that must NOT appear (case-insensitive) |
| `match_pattern` | No | Regex the response must match |
| `max_tokens` | No | Maximum acceptable token usage |

## Tips

- Use `required_keywords` for concrete expectations (e.g., a security review should mention "SQL injection")
- Use `forbidden_keywords` to catch false positives (e.g., a review shouldn't say "looks good" when there's a bug)
- Use `match_pattern` for structural checks (e.g., output must contain a markdown table)
- Keep `expected` descriptions specific — "should identify the vulnerability" is better than "should work"
