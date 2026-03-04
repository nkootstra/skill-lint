import OpenAI from "openai";
import { Result } from "better-result";
import { ProviderRequestError } from "../errors.js";
import { retryWithBackoff } from "../utils/retry.js";
import type { LLMMessage, LLMProvider, LLMResponse } from "./types.js";

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  readonly model: string;
  private client: OpenAI;

  constructor(apiKey: string, model = "gpt-4o") {
    this.model = model;
    this.client = new OpenAI({ apiKey });
  }

  async complete(messages: LLMMessage[]): Promise<Result<LLMResponse, ProviderRequestError>> {
    return Result.tryPromise({
      try: async () => {
        const start = Date.now();
        const response = await retryWithBackoff(
          () =>
            this.client.chat.completions.create({
              model: this.model,
              messages: messages.map((m) => ({ role: m.role, content: m.content })),
              max_tokens: 4096,
            }),
          { label: `openai/${this.model}` },
        );

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
          message: `OpenAI API request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          provider: "openai",
          cause,
        }),
    });
  }
}
