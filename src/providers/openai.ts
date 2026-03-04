import OpenAI from "openai";
import type { LLMMessage, LLMProvider, LLMResponse } from "./types.js";

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  readonly model: string;
  private client: OpenAI;

  constructor(apiKey: string, model = "gpt-4o") {
    this.model = model;
    this.client = new OpenAI({ apiKey });
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
