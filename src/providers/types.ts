import type { Result } from "better-result";
import type { ProviderRequestError } from "../errors.js";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  content: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
  latency_ms: number;
  model: string;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  complete(messages: LLMMessage[]): Promise<Result<LLMResponse, ProviderRequestError>>;
}
