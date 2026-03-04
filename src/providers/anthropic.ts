import Anthropic from "@anthropic-ai/sdk";
import { Result } from "better-result";
import { ProviderRequestError } from "../errors.js";
import { retryWithBackoff } from "../utils/retry.js";
import type { LLMMessage, LLMProvider, LLMResponse } from "./types.js";

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  readonly model: string;
  private client: Anthropic;

  constructor(apiKey: string, model = "claude-sonnet-4-20250514") {
    this.model = model;
    this.client = new Anthropic({ apiKey });
  }

  async complete(messages: LLMMessage[]): Promise<Result<LLMResponse, ProviderRequestError>> {
    const systemMessages = messages.filter((m) => m.role === "system");
    const nonSystemMessages = messages.filter((m) => m.role !== "system");
    const systemPrompt = systemMessages.map((m) => m.content).join("\n\n") || undefined;

    return Result.tryPromise({
      try: async () => {
        const start = Date.now();
        const response = await retryWithBackoff(
          () =>
            this.client.messages.create({
              model: this.model,
              max_tokens: 4096,
              system: systemPrompt,
              messages: nonSystemMessages.map((m) => ({
                role: m.role as "user" | "assistant",
                content: m.content,
              })),
            }),
          { label: `anthropic/${this.model}` },
        );

        const content = response.content
          .filter((block) => block.type === "text")
          .map((block) => (block.type === "text" ? block.text : ""))
          .join("");

        return {
          content,
          usage: {
            input_tokens: response.usage.input_tokens,
            output_tokens: response.usage.output_tokens,
            total_tokens: response.usage.input_tokens + response.usage.output_tokens,
          },
          latency_ms: Date.now() - start,
          model: response.model,
        };
      },
      catch: (cause) =>
        new ProviderRequestError({
          message: `Anthropic API request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          provider: "anthropic",
          cause,
        }),
    });
  }
}
