import { z } from "zod";

export const extractionSchemaV1 = z.object({
  document_type: z.string().nullable(),
  case_number: z.string().nullable(),
  jurisdictions: z.array(z.string()),
  parties: z.array(
    z.object({
      name: z.string(),
      role: z.string().nullable(),
    }),
  ),
  dates: z.array(
    z.object({
      date: z.string(),
      what_happened: z.string(),
      page: z.number().int().nullable(),
    }),
  ),
  events: z.array(
    z.object({
      summary: z.string(),
      page: z.number().int().nullable(),
    }),
  ),
});

export type ExtractionV1 = z.infer<typeof extractionSchemaV1>;

export const editClassificationSchema = z.object({
  edit_type: z.enum([
    "ADDED_FACT",
    "REMOVED_HALLUCINATION",
    "REPHRASED_STYLE",
    "RESTRUCTURED",
    "CITATION_FIX",
    "TERMINOLOGY_SWAP",
    "UNCATEGORIZED",
  ]),
  rationale: z.string(),
  // For TERMINOLOGY_SWAP / REPHRASED_STYLE — extracted (pattern, replacement)
  // pairs that should become candidate style rules. Empty if not applicable.
  style_rules: z
    .array(
      z.object({
        pattern: z.string(),
        replacement: z.string(),
        rationale: z.string(),
      }),
    )
    .default([]),
});

export type EditClassification = z.infer<typeof editClassificationSchema>;
