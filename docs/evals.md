# Writing Evals

Evals are test cases that verify your skill works correctly. skill-lint supports two formats: **`evals.json`** (recommended) and `SKILL.eval.yml`.

## evals.json Format (Recommended)

Place an `evals.json` file directly in your skill directory or inside an `evals/` subdirectory:

```
skills/
  my-skill/
    SKILL.md
    evals.json              # Option 1: directly in skill folder
```

```
skills/
  my-skill/
    SKILL.md
    evals/
      evals.json            # Option 2: in evals/ subdirectory
```

Both placements are auto-detected. The direct placement (`skills/my-skill/evals.json`) is simpler for most cases; the `evals/` subdirectory is useful when you also have fixture files alongside your evals.

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
    },
    {
      "id": 2,
      "prompt": "Explain what this code does",
      "expected_output": "Should give a clear explanation of the code's purpose",
      "files": ["evals/files/complex.py"],
      "required_keywords": ["function", "return"],
      "forbidden_keywords": ["I don't know"]
    }
  ]
}
```

This format is compatible with [Anthropic's skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator) and is the preferred way to write evals because it's the format used by the broader skill ecosystem.

### evals.json Fields

| Field | Required | Description |
|-------|----------|-------------|
| `skill_name` | Yes | Name of the skill being tested |
| `evals[].id` | Yes | Numeric identifier (converted to `"eval-${id}"` internally) |
| `evals[].prompt` | Yes | The input sent to the skill |
| `evals[].expected_output` | Yes | What the response should do (natural language) |
| `evals[].files` | No | Files to inject into the prompt (relative to skill directory) |
| `evals[].expectations` | No | Explicit checkpoints the LLM judge must verify individually |
| `evals[].required_keywords` | No | Words that must appear in the response (case-insensitive) |
| `evals[].forbidden_keywords` | No | Words that must NOT appear (case-insensitive) |
| `evals[].match_pattern` | No | Regex the response must match |
| `evals[].max_tokens` | No | Maximum acceptable token usage |
| `evals[].graders` | No | Weighted graders for partial credit scoring (see below) |

### File Injection

When a test case includes `files`, skill-lint reads each file (relative to the skill directory) and appends their contents to the prompt. This lets you test skills against real code or data without embedding it in the prompt string:

```json
{
  "id": 1,
  "prompt": "Review this code for security issues",
  "expected_output": "Should identify the SQL injection vulnerability",
  "files": ["evals/files/vulnerable-app.py"]
}
```

The file contents are appended as a `## Files` section with each file in a fenced code block.

### Expectations

The `expectations` field is an array of statements the LLM judge must verify individually. When present, the judge prompt includes each expectation as a numbered checkpoint and requires all expectations to be satisfied for the test to pass.

```json
{
  "id": 1,
  "prompt": "Write a sorting function",
  "expected_output": "Should produce a working sort",
  "expectations": [
    "The output includes a function definition",
    "The function handles empty arrays",
    "The function returns a sorted array"
  ]
}
```

## SKILL.eval.yml Format (Alternative)

You can also co-locate evals as `SKILL.eval.yml` next to your skill file:

```
skills/
  my-skill/
    SKILL.md
    SKILL.eval.yml
```

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
    expectations:           # optional
      - "The output includes a function definition"
      - "The function handles empty arrays"
```

Both `evals/evals.json` and co-located `SKILL.eval.yml` files are detected. If a skill directory contains both, both are recognized (the last detected eval file is used for pairing).

### Field Mapping

| evals.json field | SKILL.eval.yml field | Notes |
|---|---|---|
| `skill_name` | `skill` | Both are accepted |
| `evals` | `tests` | Both array keys are accepted |
| `id` (number) | `name` (string) | `id` is converted to `"eval-${id}"` |
| `expected_output` | `expected` | Both are accepted |
| `files` | `files` | Injected into the prompt as file contents |
| `expectations` | `expectations` | Fed to LLM judge as explicit checkpoints |

## How Evaluation Works

Each test case goes through two stages:

### Stage 1: Hard Constraints (no LLM needed)

If you specify `required_keywords`, `forbidden_keywords`, or `match_pattern`, these are checked first. If any hard constraint fails, the test fails immediately without needing an LLM judge call.

### Stage 2: LLM-as-Judge

If hard constraints pass (or none are defined), the LLM evaluates whether the response meets the `expected` behavior. It returns a pass/fail, a 0-1 score, and reasoning.

## Weighted Graders (Advanced)

For more control over evaluation, you can define multiple graders per test case with configurable weights. This enables partial credit scoring — a test that gets the hard constraints right but fails the qualitative check is better than one that fails everything.

```json
{
  "id": 1,
  "prompt": "Review this code for security issues",
  "expected_output": "Should identify vulnerabilities",
  "graders": [
    {
      "type": "hard_constraints",
      "weight": 0.7,
      "required_keywords": ["SQL injection"],
      "forbidden_keywords": ["looks good"]
    },
    {
      "type": "llm_rubric",
      "weight": 0.3,
      "expected": "Recommends parameterized queries and input validation"
    },
    {
      "type": "script",
      "weight": 0.1,
      "command": "echo $SKILL_LINT_OUTPUT | python check_format.py"
    }
  ]
}
```

When `graders` is present, the final score is the weighted average of all grader scores. A test passes when the weighted score >= 0.5.

### Grader Types

| Type | Description | Score |
|------|-------------|-------|
| `hard_constraints` | Checks `required_keywords`, `forbidden_keywords`, `match_pattern` | 1.0 if all pass, 0.0 if any fail |
| `llm_rubric` | LLM-as-judge evaluates against the `expected` behavior | 0.0-1.0 from the LLM judge |
| `script` | Runs a shell command. Exit 0 = pass. Stdout can be a score or structured JSON | Exit code + stdout output |

The `script` grader receives the agent's output via the `SKILL_LINT_OUTPUT` environment variable.

### Structured Script Grader Output

Script graders can return structured JSON for granular pass/fail reporting:

```json
{
  "score": 0.75,
  "details": "3 of 4 checks passed",
  "checks": [
    { "name": "has-function-def", "passed": true },
    { "name": "handles-edge-cases", "passed": true },
    { "name": "has-docstring", "passed": true },
    { "name": "uses-type-hints", "passed": false, "details": "No type annotations found" }
  ]
}
```

If the output is not valid JSON, it falls back to parsing stdout as a bare float (0.0-1.0), or defaults to 1.0 on exit code 0.

**Backward compatibility:** When `graders` is not specified, the existing behavior is used (hard constraints then LLM-as-judge). Existing eval files work without changes.

## Multi-Trial Evaluation (pass@k / pass^k)

Agent behavior is non-deterministic. A single run means nothing. Configure trials using a preset or explicit count:

### Eval Presets

Use `eval_preset` in your config for common trial strategies:

| Preset | Trials | Use Case |
|--------|--------|----------|
| `smoke` | 3 | Quick capability check — can the skill do this at all? |
| `reliable` | 10 | Measure consistency — is the skill reliable? |
| `regression` | 25 | High-confidence regression detection |

```yaml
# .skill-lint.yml
eval_preset: smoke
```

Or via the GitHub Action input:

```yaml
- uses: nkootstra/skill-lint@main
  with:
    eval_preset: reliable
```

An explicit `eval_trials` value always overrides the preset.

### Manual Trial Count

```yaml
eval_trials: 5
```

### Metrics

Multi-trial evaluation enables two statistical metrics:

- **pass@k**: Probability of at least 1 success in k trials. "Can the skill do this at all?"
- **pass^k**: Probability of all k trials succeeding. "Is the skill reliable?"

| Goal | Recommended Preset | Metric |
|------|-------------------|--------|
| Quick smoke test | `smoke` (3 trials) | pass@k |
| Reliable pass rate | `reliable` (10 trials) | Pass Rate |
| Regression detection | `regression` (25 trials) | pass^k |

A skill with pass@5 = 100% but pass^5 = 30% indicates it *can* do it but is flaky — investigate the transcript.

## Tips

- Use `evals.json` for new skills — it's the standard format across the skill ecosystem
- Use `required_keywords` for concrete expectations (e.g., a security review should mention "SQL injection")
- Use `forbidden_keywords` to catch false positives (e.g., a review shouldn't say "looks good" when there's a bug)
- Use `match_pattern` for structural checks (e.g., output must contain a markdown table)
- Keep `expected` descriptions specific — "should identify the vulnerability" is better than "should work"
- Grade *outcomes*, not *steps* — check what the agent produced, not the path it took
- Run minimum 3 trials (`eval_preset: smoke`) for meaningful eval results
