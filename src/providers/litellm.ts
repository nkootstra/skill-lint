import OpenAI from "openai";
import type { LLMMessage, LLMProvider, LLMResponse } from "./types.js";

/**
 * LiteLLM provider uses the OpenAI-compatible API format.
 * This works with any LiteLLM proxy or compatible endpoint.
 */
export class LiteLLMProvider implements LLMProvider {
  readonly name = "litellm";
  readonly model: string;
  private client: OpenAI;

  constructor(apiKey: string, model: string, apiBase?: string) {
    this.model = model;
    this.client = new OpenAI({
      apiKey,
      baseURL: apiBase ?? "http://localhost:4000",
    });
  }

  async complete(messages: LLMMessage[]): Promise<LLMResponse> {
    const start = Date.now();

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      max_tokens: 4096,
    });

    const latency_ms = Date.now() - start;
    const choice = response.choices[0];
    const content = choice?.message?.content ?? "";

    return {
      content,
      usage: {
        input_tokens: response.usage?.prompt_tokens ?? 0,
        output_tokens: response.usage?.completion_tokens ?? 0,
        total_tokens: response.usage?.total_tokens ?? 0,
      },
      latency_ms,
      model: response.model,
    };
  }
}
