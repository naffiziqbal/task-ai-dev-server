import { Injectable, Logger } from "@nestjs/common";
import { LlmService } from "../llm/llm.service";
import { editClassificationSchema, type EditClassification } from "../schemas";

const CLASSIFIER_SYSTEM = `You analyze single-sentence edits an operator made to a model-generated legal draft.
Classify the edit into exactly one bucket:

- ADDED_FACT: a new fact appears that wasn't in the original (operator added information)
- REMOVED_HALLUCINATION: a claim was deleted because it was unsupported or wrong
- REPHRASED_STYLE: same meaning, different wording / tone / sentence shape
- RESTRUCTURED: same content, different ordering or grouping
- CITATION_FIX: the supporting citation was corrected or replaced
- TERMINOLOGY_SWAP: a specific term was substituted (e.g. "person" → "petitioner")
- UNCATEGORIZED: doesn't fit any of the above

For TERMINOLOGY_SWAP and REPHRASED_STYLE only, you may extract up to 3 reusable
(pattern, replacement) rules. Each rule must generalize beyond the specific sentence.
For all other types, return an empty style_rules array.`;

const CLASSIFIER_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    edit_type: {
      type: "string",
      enum: [
        "ADDED_FACT",
        "REMOVED_HALLUCINATION",
        "REPHRASED_STYLE",
        "RESTRUCTURED",
        "CITATION_FIX",
        "TERMINOLOGY_SWAP",
        "UNCATEGORIZED",
      ],
    },
    rationale: { type: "string" },
    style_rules: {
      type: "array",
      items: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          replacement: { type: "string" },
          rationale: { type: "string" },
        },
        required: ["pattern", "replacement", "rationale"],
      },
    },
  },
  required: ["edit_type", "rationale", "style_rules"],
} as const;

@Injectable()
export class EditClassifier {
  private readonly log = new Logger(EditClassifier.name);
  constructor(private readonly llm: LlmService) {}

  async classify(args: {
    before: string;
    after: string;
    sectionLabel: string;
  }): Promise<EditClassification> {
    const userPrompt =
      `Section: ${args.sectionLabel}\n\n` +
      `BEFORE:\n${args.before || "(empty — sentence was added)"}\n\n` +
      `AFTER:\n${args.after || "(empty — sentence was deleted)"}`;

    try {
      const raw = await this.llm.completeJson<unknown>({
        system: CLASSIFIER_SYSTEM,
        messages: [{ role: "user", content: userPrompt }],
        maxTokens: 600,
        temperature: 0,
        fast: true,
        responseSchema: CLASSIFIER_RESPONSE_SCHEMA,
      });
      const parsed = editClassificationSchema.safeParse(raw);
      if (!parsed.success) {
        this.log.warn(`classifier schema mismatch: ${parsed.error.message.slice(0, 200)}`);
        return { edit_type: "UNCATEGORIZED", rationale: "schema mismatch", style_rules: [] };
      }
      return parsed.data;
    } catch (err) {
      this.log.warn(`classifier call failed: ${(err as Error).message}`);
      return { edit_type: "UNCATEGORIZED", rationale: "classifier error", style_rules: [] };
    }
  }
}
