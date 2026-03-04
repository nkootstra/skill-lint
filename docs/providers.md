# Provider Setup

Skill Lint supports four LLM providers. Choose the one that fits your setup.

## Anthropic (API Key)

Use the Anthropic API directly with your API key.

### Setup

1. Get an API key from [console.anthropic.com](https://console.anthropic.com)
2. Add it as a GitHub Actions secret: **Settings > Secrets > Actions > New repository secret**
   - Name: `ANTHROPIC_API_KEY`
   - Value: your API key (starts with `sk-ant-`)

### Workflow

```yaml
- uses: nkootstra/skill-lint@main
  with:
    provider: anthropic
    model: claude-sonnet-4-20250514  # optional, this is the default
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Config file

```yaml
# .skill-lint.yml
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
- uses: nkootstra/skill-lint@main
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

## Claude Code (GitHub App / Max Subscription)

Use your existing Claude Max or Pro subscription through the Claude GitHub App. **No API key needed** — the Claude App handles authentication.

### Setup

1. Install the [Claude GitHub App](https://github.com/apps/claude) on your repository
2. Configure it to have access to the repos where you want skill-lint to run
3. That's it — the Claude CLI is available in the runner environment

### Workflow

```yaml
- uses: nkootstra/skill-lint@main
  with:
    provider: claude-code
```

### Config file

```yaml
provider:
  type: claude-code
  cli_path: claude    # default, path to the Claude CLI
  model: ""           # uses your subscription's default model
```

### How it works

The `claude-code` provider shells out to the `claude` CLI with `--print --output-format json`. This uses your Claude Max/Pro subscription credits rather than per-token API billing. It's ideal if you already have the Claude GitHub App installed and want to avoid managing separate API keys.

### Specifying a model

If you want to use a specific model with your subscription:

```yaml
- uses: nkootstra/skill-lint@main
  with:
    provider: claude-code
    model: claude-sonnet-4-20250514
```

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
- uses: nkootstra/skill-lint@main
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

Skill Lint has a plugin system for adding custom providers. See the `CommandProvider` class in `src/providers/plugin.ts` for wrapping any CLI tool as a provider, or create a JS plugin module:

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
