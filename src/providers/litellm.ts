import OpenAI from "openai";
import { Result } from "better-result";
import { ProviderRequestError } from "../errors.js";
import type { LLMMessage, LLMProvider, LLMResponse } from "./types.js";

export class LiteLLMProvider implements LLMProvider {
  readonly name = "litellm";
  readonly model: string;
  private client: OpenAI;

  constructor(apiKey: string, model: string, apiBase?: string) {
    this.model = model;
    this.client = new OpenAI({ apiKey, baseURL: apiBase ?? "http://localhost:4000" });
  }

  async complete(messages: LLMMessage[]): Promise<Result<LLMResponse, ProviderRequestError>> {
    return Result.tryPromise({
      try: async () => {
        const start = Date.now();
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          max_tokens: 4096,
        });

        return {
          content: response.choices[0]?.message?.content ?? "",
          usage: {
            input_tokens: response.usage?.prompt_tokens ?? 0,
            output_tokens: response.usage?.completion_tokens ?? 0,
            total_tokens: response.usage?.total_tokens ?? 0,
          },
          latency_ms: Date.now() - start,
          model: response.model,
        };
      },
      catch: (cause) =>
        new ProviderRequestError({
          message: `LiteLLM request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          provider: "litellm",
          cause,
        }),
    });
  }
}
