# Provider Setup

Skill Eval supports four LLM providers. Choose the one that fits your setup.

## Anthropic (API Key)

Use the Anthropic API directly with your API key.

### Setup

1. Get an API key from [console.anthropic.com](https://console.anthropic.com)
2. Add it as a GitHub Actions secret: **Settings > Secrets > Actions > New repository secret**
   - Name: `ANTHROPIC_API_KEY`
   - Value: your API key (starts with `sk-ant-`)

### Workflow

```yaml
- uses: nkootstra/skill-eval@main
  with:
    provider: anthropic
    model: claude-sonnet-4-20250514  # optional, this is the default
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Config file

```yaml
# .skill-eval.yml
provider:
  type: anthropic
  model: claude-sonnet-4-20250514
  api_key_env: ANTHROPIC_API_KEY
```

---

## OpenAI (API Key)

Use OpenAI's API with your API key.

### Setup

1. Get an API key from [platform.openai.com](https://platform.openai.com)
2. Add it as a GitHub Actions secret:
   - Name: `OPENAI_API_KEY`
   - Value: your API key (starts with `sk-`)

### Workflow

```yaml
- uses: nkootstra/skill-eval@main
  with:
    provider: openai
    model: gpt-4o  # optional, this is the default
    openai_api_key: ${{ secrets.OPENAI_API_KEY }}
```

### Config file

```yaml
provider:
  type: openai
  model: gpt-4o
  api_key_env: OPENAI_API_KEY
```

---

## Claude Code (Pro/Max Subscription)

Use your Claude Pro or Max subscription to run evals. No per-token API billing — usage counts against your subscription. The CLI is auto-installed on the runner.

### Setup

1. **Generate an OAuth token** by running this locally (requires an active Claude Pro or Max subscription):

   ```bash
   claude setup-token
   ```

   This prints a long-lived token. Copy it.

2. **Add the token as a GitHub Actions secret:**
   - Go to your repository's **Settings > Secrets and variables > Actions**
   - Click **New repository secret**
   - Name: `CLAUDE_CODE_OAUTH_TOKEN`
   - Value: paste the token from step 1

### Workflow

```yaml
- uses: nkootstra/skill-eval@main
  with:
    provider: claude-code
    claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

The default model is `claude-haiku-4-5-20250414` (cheapest, fast). To use a different model:

```yaml
- uses: nkootstra/skill-eval@main
  with:
    provider: claude-code
    model: sonnet  # also: opus, haiku, or a full model ID
    claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

### Config file

```yaml
provider:
  type: claude-code
  model: claude-haiku-4-5-20250414  # default
  # cli_path: ""                    # auto-installed; set to override
```

### How it works

The `claude-code` provider runs the Claude Code CLI (`claude --print --output-format json`) as a subprocess. On the first invocation, if the CLI isn't found on the runner, it is automatically installed (pinned to a specific version for stability).

Authentication is handled via the `CLAUDE_CODE_OAUTH_TOKEN` environment variable, which the CLI reads automatically. This uses your subscription credits rather than per-token API billing.

### Performance

> **Expect 5-15 minutes** for a typical eval run (3 test cases). This is significantly slower than the `anthropic` provider.

Each eval makes 2 LLM calls (skill response + judge), and each call spawns a separate `claude` CLI process. The Claude Code CLI has a cold start overhead of ~30-60 seconds per invocation (loading the Node.js runtime, authenticating, initializing). With 3 evals running in parallel, that's 6 CLI invocations.

The `anthropic` provider makes the same calls as direct HTTP requests with zero startup overhead — typically completing the same 3 evals in under 60 seconds.

**Choose this provider when:**
- You want to use your existing Claude subscription (no separate API billing)
- Eval speed is not a priority
- You're running a small number of evals

**Choose `anthropic` when:**
- You need fast CI feedback (< 1 minute)
- You're running many evals
- Per-token API costs are acceptable (~$0.001/eval with haiku)

### Token expiry

If your OAuth token expires, evals will fail with:

> Authentication failed — your OAuth token may be expired or invalid. Run 'claude setup-token' locally to generate a new token, then update the CLAUDE_CODE_OAUTH_TOKEN secret.

Run `claude setup-token` again locally and update the GitHub secret.

### Alternative: API key authentication

You can also authenticate the CLI with an Anthropic API key instead of an OAuth token. Set `ANTHROPIC_API_KEY` as an environment variable in your workflow:

```yaml
- uses: nkootstra/skill-eval@main
  with:
    provider: claude-code
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

This uses per-token API billing rather than your subscription.

---

## LiteLLM (Custom Proxy)

Use any LLM through a [LiteLLM](https://docs.litellm.ai/) proxy. This gives you access to 100+ models (Anthropic, OpenAI, Azure, Bedrock, Gemini, local models, etc.) through a single OpenAI-compatible endpoint.

### Setup

1. Deploy a LiteLLM proxy (see [LiteLLM docs](https://docs.litellm.ai/docs/proxy/quick_start))
2. Add your LiteLLM API key as a GitHub Actions secret:
   - Name: `LITELLM_API_KEY`
   - Value: your LiteLLM proxy key

### Workflow

```yaml
- uses: nkootstra/skill-eval@main
  with:
    provider: litellm
    model: "anthropic/claude-sonnet-4-20250514"  # LiteLLM model format
    litellm_api_key: ${{ secrets.LITELLM_API_KEY }}
    litellm_api_base: "https://your-litellm-proxy.com"
```

### Config file

```yaml
provider:
  type: litellm
  model: "anthropic/claude-sonnet-4-20250514"
  api_key_env: LITELLM_API_KEY
  api_base: "https://your-litellm-proxy.com"
```

### Example LiteLLM model names

| Backend | Model name |
|---------|------------|
| Anthropic | `anthropic/claude-sonnet-4-20250514` |
| OpenAI | `openai/gpt-4o` |
| Azure | `azure/gpt-4o` |
| AWS Bedrock | `bedrock/anthropic.claude-3-sonnet-20240229-v1:0` |
| Google | `gemini/gemini-pro` |
| Local (Ollama) | `ollama/llama3` |
| OpenRouter | `z-ai/glm-4.5-air:free` (via `api_base`) |
| Google Gemini | `gemini-3.1-flash-lite-preview` (via `api_base`) |

### OpenRouter

The LiteLLM provider works with any OpenAI-compatible endpoint, including [OpenRouter](https://openrouter.ai). Point `api_base` at the OpenRouter API and use OpenRouter model IDs.

1. Get an API key from [openrouter.ai/keys](https://openrouter.ai/keys)
2. Add it as a GitHub Actions secret: `OPENROUTER_API_KEY`

**Workflow:**

```yaml
- uses: nkootstra/skill-eval@main
  with:
    provider: litellm
    model: "z-ai/glm-4.5-air:free"
    litellm_api_key: ${{ secrets.OPENROUTER_API_KEY }}
    litellm_api_base: "https://openrouter.ai/api/v1"
```

**Config file:**

```yaml
provider:
  type: litellm
  model: "z-ai/glm-4.5-air:free"
  api_key_env: OPENROUTER_API_KEY
  api_base: "https://openrouter.ai/api/v1"
```

### Google Gemini

You can use Google Gemini models directly through their OpenAI-compatible endpoint — no LiteLLM proxy needed.

1. Get an API key from [aistudio.google.com/api-keys](https://aistudio.google.com/api-keys)
2. Add it as a GitHub Actions secret: `GEMINI_API_KEY`

**Workflow:**

```yaml
- uses: nkootstra/skill-eval@main
  with:
    provider: litellm
    model: "gemini-3.1-flash-lite-preview"
    litellm_api_key: ${{ secrets.GEMINI_API_KEY }}
    litellm_api_base: "https://generativelanguage.googleapis.com/v1beta/openai/"
```

**Config file:**

```yaml
provider:
  type: litellm
  model: "gemini-3.1-flash-lite-preview"
  api_key_env: GEMINI_API_KEY
  api_base: "https://generativelanguage.googleapis.com/v1beta/openai/"
```

### Self-hosted LiteLLM proxy

If you're running LiteLLM locally or in your infrastructure:

```bash
# Start LiteLLM proxy
litellm --model anthropic/claude-sonnet-4-20250514 --port 4000

# In your config
provider:
  type: litellm
  model: "anthropic/claude-sonnet-4-20250514"
  api_base: "http://localhost:4000"
```

---

## Extending with Custom Providers

Skill Eval has a plugin system for adding custom providers. See the `CommandProvider` class in `src/providers/plugin.ts` for wrapping any CLI tool as a provider, or create a JS plugin module:

```javascript
// my-provider.js
export function createProvider(config) {
  return {
    name: "my-provider",
    model: config.model ?? "custom",
    async complete(messages) {
      // Your LLM integration here
      // Must return Result<LLMResponse, ProviderRequestError>
    }
  };
}
```
