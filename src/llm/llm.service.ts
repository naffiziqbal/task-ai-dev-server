import { Injectable, Logger } from "@nestjs/common";
import OpenAI from "openai";

export interface LlmMessage {
  // "model" is accepted for legacy callers (Gemini terminology); it maps to
  // OpenAI's "assistant" role at the API boundary.
  role: "user" | "assistant" | "model";
  content: string;
}

export interface LlmCallOptions {
  system?: string;
  messages: LlmMessage[];
  maxTokens?: number;
  temperature?: number;
  // Use the lighter, cheaper model. We default to it for classification.
  fast?: boolean;
  // When set, ask OpenAI for JSON output matching this JSON Schema.
  // We pass strict: false so we don't have to retrofit every callsite's
  // schema for OpenAI's strict-mode constraints (all-fields-required,
  // additionalProperties: false everywhere). Callers still re-validate the
  // result against zod, so structural drift fails closed.
  responseSchema?: Record<string, unknown>;
  // Prompt-cache hint — OpenAI does automatic caching on long prompts, so
  // this is a no-op flag retained for source compatibility with callers.
  cachePreamble?: boolean;
}

@Injectable()
export class LlmService {
  private readonly log = new Logger(LlmService.name);
  private client: OpenAI | null = null;
  private readonly model = process.env.OPENAI_MODEL ?? "gpt-5.4";
  private readonly fastModel =
    process.env.OPENAI_FAST_MODEL ?? "gpt-5.4-mini";

  private get openai(): OpenAI {
    if (!this.client) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error(
          "OPENAI_API_KEY is not set — LLM calls require a real key. " +
            "Get one at https://platform.openai.com/api-keys and put it in .env.",
        );
      }
      this.client = new OpenAI({ apiKey });
    }
    return this.client;
  }

  async complete(opts: LlmCallOptions): Promise<string> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (opts.system) messages.push({ role: "system", content: opts.system });
    for (const m of opts.messages) {
      messages.push({
        role: m.role === "model" ? "assistant" : m.role,
        content: m.content,
      });
    }

    const request: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: opts.fast ? this.fastModel : this.model,
      messages,
      max_completion_tokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0.2,
    };
    if (opts.responseSchema) {
      request.response_format = {
        type: "json_schema",
        json_schema: {
          name: "result",
          schema: adaptSchemaForOpenAI(opts.responseSchema) as Record<string, unknown>,
          strict: false,
        },
      };
    }

    const response = await this.openai.chat.completions.create(request);
    return response.choices[0]?.message?.content ?? "";
  }

  // Convenience: ask the model for JSON. Prefer passing a `responseSchema` —
  // it constrains the format. Without one we fall back to parsing the first
  // fenced block or the whole response. Schema *validation* is still the
  // caller's job (use the zod schemas in src/schemas.ts).
  async completeJson<T = unknown>(opts: LlmCallOptions): Promise<T> {
    const text = await this.complete(opts);
    if (opts.responseSchema) {
      try {
        return JSON.parse(text) as T;
      } catch (err) {
        this.log.error(
          `model returned non-JSON despite responseSchema: ${text.slice(0, 200)}`,
        );
        throw err;
      }
    }
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const raw = fenced ? fenced[1] : text;
    try {
      return JSON.parse(raw) as T;
    } catch (err) {
      this.log.error(`failed to parse JSON from model: ${text.slice(0, 200)}`);
      throw err;
    }
  }
}

// The existing response schemas were written for Gemini, which accepts
// OpenAPI-flavored `{ type: "string", nullable: true }`. Standard JSON Schema
// (and OpenAI) expect `{ type: ["string", "null"] }`. Convert recursively.
function adaptSchemaForOpenAI(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(adaptSchemaForOpenAI);
  if (typeof schema !== "object" || schema === null) return schema;
  const src = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (k === "nullable") continue;
    out[k] = adaptSchemaForOpenAI(v);
  }
  if (src.nullable === true && typeof src.type === "string") {
    out.type = [src.type, "null"];
  }
  return out;
}
