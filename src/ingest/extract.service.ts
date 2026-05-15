import { Injectable, Logger } from "@nestjs/common";
import { LlmService } from "../llm/llm.service";
import { extractionSchemaV1, type ExtractionV1 } from "../schemas";

const EXTRACTION_SYSTEM = `You are an information-extraction component for a legal-document workflow.
You will be given the text of a single document, with page anchors of the form [page N] preceding each page's text.
Return a JSON object matching the supplied schema. Rules:
- Use ONLY information that appears in the text. If a field cannot be determined, return null (or an empty array for lists).
- For each date or event, set "page" to the [page N] anchor that contains it.
- Do not invent parties, dates, or jurisdictions.`;

// JSON Schema passed to the LLM as a structured-output hint. Downstream
// zod validation (extractionSchemaV1) handles any drift if the model
// returns fields that don't match.
const EXTRACTION_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    document_type: { type: "string", nullable: true },
    case_number: { type: "string", nullable: true },
    jurisdictions: { type: "array", items: { type: "string" } },
    parties: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          role: { type: "string", nullable: true },
        },
        required: ["name"],
      },
    },
    dates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string" },
          what_happened: { type: "string" },
          page: { type: "integer", nullable: true },
        },
        required: ["date", "what_happened"],
      },
    },
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          summary: { type: "string" },
          page: { type: "integer", nullable: true },
        },
        required: ["summary"],
      },
    },
  },
  required: ["jurisdictions", "parties", "dates", "events"],
} as const;

@Injectable()
export class ExtractService {
  private readonly log = new Logger(ExtractService.name);

  constructor(private readonly llm: LlmService) {}

  async extract(pages: { pageNumber: number; text: string }[]): Promise<ExtractionV1> {
    const anchored = pages
      .filter((p) => p.text.trim().length > 0)
      .map((p) => `[page ${p.pageNumber}]\n${p.text}`)
      .join("\n\n");

    if (anchored.length === 0) {
      // Nothing readable — return an empty extraction rather than calling
      // the model on garbage. This is correct behavior, not a fallback.
      return {
        document_type: null,
        case_number: null,
        jurisdictions: [],
        parties: [],
        dates: [],
        events: [],
      };
    }

    const trimmed = anchored.length > 60_000 ? anchored.slice(0, 60_000) : anchored;

    const raw = await this.llm.completeJson<unknown>({
      system: EXTRACTION_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Document text:\n${trimmed}`,
        },
      ],
      maxTokens: 2048,
      temperature: 0,
      responseSchema: EXTRACTION_RESPONSE_SCHEMA,
    });

    const parsed = extractionSchemaV1.safeParse(raw);
    if (!parsed.success) {
      this.log.warn(
        `extraction schema validation failed: ${parsed.error.message.slice(0, 300)}`,
      );
      // Return the best-effort empty extraction. Don't crash the pipeline
      // over schema drift — the chunks are still useful for retrieval.
      return {
        document_type: null,
        case_number: null,
        jurisdictions: [],
        parties: [],
        dates: [],
        events: [],
      };
    }
    return parsed.data;
  }
}
