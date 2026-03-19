# Installation & Deployment

## Installing the GitHub Action

Skill Eval runs as a GitHub Action — no separate server needed. Add a workflow file to your repository:

### Step 1: Create the workflow

Create `.github/workflows/skill-eval.yml`:

```yaml
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
          fetch-depth: 0  # Required for A/B comparison

      - uses: nkootstra/skill-eval@main
        with:
          provider: anthropic
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Step 2: Add your API key

Go to **Settings > Secrets and variables > Actions** in your repository and add the appropriate secret for your provider (see [Provider Setup](providers.md)).

### Step 3: Add a config file (optional)

Copy `.skill-eval.yml.example` to `.skill-eval.yml` in your repo root to customize behavior.

### Step 4: Add skill files

Create skills in the `skills/` directory:

```
skills/
  my-skill/
    SKILL.md
    SKILL.eval.yml
    references/
      guide.md
```

## How It Triggers

The action runs on every pull request that modifies files in the `skills/` directory (or `.skill-eval.yml`). It only evaluates skills that were changed in the PR.

Changes to reference files inside a skill directory also trigger evaluation for that skill.

## Outputs

The action provides three outputs you can use in subsequent workflow steps:

| Output | Description |
|--------|-------------|
| `passed` | `"true"` or `"false"` |
| `results` | JSON array of per-skill results |
| `summary` | Human-readable summary |

Example usage:

```yaml
- uses: nkootstra/skill-eval@main
  id: lint
  with:
    provider: anthropic
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}

- run: echo "Passed: ${{ steps.lint.outputs.passed }}"
```

## For Developers: Building from Source

```bash
# Clone the repo
git clone https://github.com/nkootstra/skill-eval.git
cd skill-eval

# Install dependencies
npm install

# Run tests
npm test

# Type check
npm run typecheck

# Build the action (bundles everything into dist/)
npm run build
```

### Project Structure

```
src/
├── config/           # Config schema (Zod) + loader
├── providers/        # LLM provider abstraction (Anthropic, OpenAI, LiteLLM, Claude Code)
├── skills/           # Skill detection + parsing
├── evaluator/        # Evaluation pipeline (lint, eval, benchmark, compare, suggest)
├── reporter/         # GitHub PR comment + check status
├── errors.ts         # Tagged error types (better-result)
├── utils/            # Git diff utilities
└── index.ts          # Entry point
```

### Error Handling

The codebase uses [better-result](https://better-result.dev) for type-safe error handling. All fallible operations return `Result<T, E>` types with tagged errors for exhaustive matching:

```typescript
import { Result } from "better-result";
import { ProviderRequestError } from "./errors.js";

const response = await provider.complete(messages);

if (response.isErr()) {
  // response.error is typed as ProviderRequestError
  console.log(response.error.provider); // "anthropic"
}
```
