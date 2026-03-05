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

## Anthropic `evals.json` Format

skill-lint also supports Anthropic's `evals.json` format, used by [Anthropic's skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator). Place the file at `evals/evals.json` inside your skill directory:

```
skills/
  my-skill/
    SKILL.md
    evals/
      evals.json
```

```json
{
  "skill_name": "my-skill",
  "evals": [
    {
      "id": 1,
      "prompt": "Write a hello world function",
      "expected_output": "Should produce a working function",
      "files": ["evals/files/sample.py"],
      "expectations": [
        "The output includes a function definition",
        "The function prints hello world"
      ]
    }
  ]
}
```

### Field Mapping

| Anthropic field | skill-lint field | Notes |
|---|---|---|
| `skill_name` | `skill` | Both are accepted |
| `evals` | `tests` | Both array keys are accepted |
| `id` (number) | `name` (string) | Converted to `"eval-${id}"` |
| `expected_output` | `expected` | Both are accepted |
| `files` | `files` | Stored but not injected into prompts yet |
| `expectations` | `expectations` | Fed to LLM judge as explicit checkpoints |

### Expectations

The `expectations` field is an array of statements the LLM judge must verify individually. When present, the judge prompt includes each expectation as a numbered checkpoint and requires all expectations to be satisfied for the test to pass.

Expectations work with both the Anthropic format and the standard format:

```yaml
tests:
  - name: Code generation test
    prompt: "Write a sorting function"
    expected: "Should produce a working sort"
    expectations:
      - "The output includes a function definition"
      - "The function handles empty arrays"
      - "The function returns a sorted array"
```

Both `evals/evals.json` and co-located `SKILL.eval.yml` files are detected. If a skill directory contains both, both are recognized (the last detected eval file is used for pairing).

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

## Weighted Graders (Advanced)

For more control over evaluation, you can define multiple graders per test case with configurable weights. This enables partial credit scoring — a test that gets the hard constraints right but fails the qualitative check is better than one that fails everything.

```yaml
tests:
  - name: Security review
    prompt: "Review this code for security issues"
    expected: "Should identify vulnerabilities"
    graders:
      - type: hard_constraints
        weight: 0.7
        required_keywords:
          - "SQL injection"
        forbidden_keywords:
          - "looks good"
      - type: llm_rubric
        weight: 0.3
        expected: "Recommends parameterized queries and input validation"
      - type: script
        weight: 0.1
        command: "echo $SKILL_LINT_OUTPUT | python -c 'import sys,json; json.load(sys.stdin)'"
```

When `graders` is present, the final score is the weighted average of all grader scores. A test passes when the weighted score >= 0.5.

### Grader Types

| Type | Description | Score |
|------|-------------|-------|
| `hard_constraints` | Checks `required_keywords`, `forbidden_keywords`, `match_pattern` | 1.0 if all pass, 0.0 if any fail |
| `llm_rubric` | LLM-as-judge evaluates against the `expected` behavior | 0.0-1.0 from the LLM judge |
| `script` | Runs a shell command. Exit 0 = pass. Stdout can be a score (0.0-1.0) | Exit code + optional stdout score |

The `script` grader receives the agent's output via the `SKILL_LINT_OUTPUT` environment variable.

**Backward compatibility:** When `graders` is not specified, the existing behavior is used (hard constraints then LLM-as-judge). Existing eval files work without changes.

## Multi-Trial Evaluation (pass@k / pass^k)

Agent behavior is non-deterministic. A single run means nothing. Set `eval_trials` in your config to run each test case multiple times:

```yaml
eval_trials: 5
```

This enables two statistical metrics:

- **pass@k**: Probability of at least 1 success in k trials. "Can the skill do this at all?"
- **pass^k**: Probability of all k trials succeeding. "Is the skill reliable?"

| Goal | Recommended Trials | Metric |
|------|-------------------|--------|
| Quick smoke test | 3-5 | pass@k |
| Reliable pass rate | 10-25 | Pass Rate |
| Regression detection | 25-50 | pass^k |

A skill with pass@5 = 100% but pass^5 = 30% indicates it *can* do it but is flaky — investigate the transcript.

## Tips

- Use `required_keywords` for concrete expectations (e.g., a security review should mention "SQL injection")
- Use `forbidden_keywords` to catch false positives (e.g., a review shouldn't say "looks good" when there's a bug)
- Use `match_pattern` for structural checks (e.g., output must contain a markdown table)
- Keep `expected` descriptions specific — "should identify the vulnerability" is better than "should work"
- Grade *outcomes*, not *steps* — check what the agent produced, not the path it took
