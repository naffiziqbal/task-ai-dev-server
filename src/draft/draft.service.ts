import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { DbService } from "../db/db.service";
import { RetrieveService } from "../retrieve/retrieve.service";
import { LlmService } from "../llm/llm.service";
import { StyleGuideService } from "../learning/style-guide.service";
import { FewShotService } from "../learning/few-shot.service";
import {
  CASE_FACT_SECTIONS,
  SECTION_LABELS,
  SECTION_SUBQUERIES,
  type CaseFactSection,
} from "../sections";
import type { Citation, DraftSection } from "../types";
import { CITATION_RE, DRAFT_SYSTEM, formatEvidence, formatFewShot } from "./prompts";

interface DraftRow {
  id: string;
  case_id: string;
  version: number;
  sections: DraftSection[];
  citations: Citation[];
  generated_at: string;
  updated_at: string;
  edited: boolean;
}

@Injectable()
export class DraftService {
  private readonly log = new Logger(DraftService.name);

  constructor(
    private readonly db: DbService,
    private readonly retrieve: RetrieveService,
    private readonly llm: LlmService,
    private readonly styleGuide: StyleGuideService,
    private readonly fewShot: FewShotService,
  ) {}

  async generate(caseId: string): Promise<DraftRow> {
    const styleGuide = await this.styleGuide.get();
    const sections: DraftSection[] = [];
    const allCitations: Citation[] = [];

    for (const key of CASE_FACT_SECTIONS) {
      const passages = await this.retrieve.retrieveMany({
        caseId,
        queries: SECTION_SUBQUERIES[key],
        perQueryK: 6,
        finalK: 18,
      });
      const fewShot = await this.fewShot.findRelevant({ section: key, k: 2 });
      const fewShotBlock = formatFewShot(fewShot);

      const systemParts = [DRAFT_SYSTEM];
      if (styleGuide.trim()) {
        systemParts.push(`STYLE GUIDE (operator-approved):\n${styleGuide.trim()}`);
      }
      if (fewShotBlock) systemParts.push(fewShotBlock);

      const evidence = formatEvidence(passages);
      const userPrompt =
        `Section to draft: ${SECTION_LABELS[key]}\n\n` +
        `EVIDENCE:\n${evidence}\n\n` +
        `Write the "${SECTION_LABELS[key]}" section now. Remember: one sentence per line, ` +
        `each sentence ends with at least one [c:<chunk_id>] citation that appears in the evidence above.`;

      const text = await this.llm.complete({
        system: systemParts.join("\n\n"),
        messages: [{ role: "user", content: userPrompt }],
        maxTokens: 1200,
        temperature: 0.2,
        cachePreamble: true,
      });

      const validated = validateAndExtractCitations(text, passages);
      const section: DraftSection = {
        key,
        label: SECTION_LABELS[key],
        text: validated.text,
        citations: validated.citations,
        insufficientEvidence: validated.insufficient,
      };
      sections.push(section);
      allCitations.push(...validated.citations);
      this.log.log(
        `section=${key} sentences=${validated.text.split("\n").length} citations=${validated.citations.length} insufficient=${validated.insufficient}`,
      );
    }

    const inserted = await this.db.query<DraftRow>(
      `INSERT INTO drafts (case_id, version, sections, citations)
       VALUES ($1, 1, $2, $3)
       RETURNING *`,
      [caseId, JSON.stringify(sections), JSON.stringify(allCitations)],
    );
    return inserted.rows[0];
  }

  async get(id: string): Promise<DraftRow> {
    const { rows } = await this.db.query<DraftRow>(
      "SELECT * FROM drafts WHERE id = $1",
      [id],
    );
    if (!rows[0]) throw new NotFoundException(`draft ${id} not found`);
    return rows[0];
  }

  async listByCase(caseId: string): Promise<DraftRow[]> {
    const { rows } = await this.db.query<DraftRow>(
      "SELECT * FROM drafts WHERE case_id = $1 ORDER BY generated_at DESC",
      [caseId],
    );
    return rows;
  }
}

interface ValidationResult {
  text: string;
  citations: Citation[];
  insufficient: boolean;
}

function validateAndExtractCitations(
  raw: string,
  passages: { chunkId: string; documentId: string; pageNumber: number; charStart: number; charEnd: number }[],
): ValidationResult {
  if (/^\s*INSUFFICIENT EVIDENCE:/im.test(raw)) {
    const line = raw.split("\n").find((l) => /INSUFFICIENT EVIDENCE/i.test(l)) ?? "";
    return { text: line.trim(), citations: [], insufficient: true };
  }

  const byId = new Map<string, typeof passages[number]>();
  for (const p of passages) byId.set(p.chunkId, p);

  const keptSentences: string[] = [];
  const allCitations: Citation[] = [];

  const sentences = raw
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const sentence of sentences) {
    // Find every chunk-id mentioned in the sentence.
    const matches = [...sentence.matchAll(CITATION_RE)];
    const valid = matches
      .map((m) => m[1])
      .filter((id) => byId.has(id))
      .map((id) => {
        const p = byId.get(id)!;
        const cit: Citation = {
          token: `[c:${id}]`,
          chunkId: p.chunkId,
          documentId: p.documentId,
          pageNumber: p.pageNumber,
          charStart: p.charStart,
          charEnd: p.charEnd,
        };
        return cit;
      });
    // Sentence-level grounding rule: must have at least one valid citation.
    if (valid.length === 0) continue;
    keptSentences.push(sentence);
    allCitations.push(...valid);
  }

  if (keptSentences.length === 0) {
    return {
      text: "INSUFFICIENT EVIDENCE: the model could not produce grounded sentences for this section.",
      citations: [],
      insufficient: true,
    };
  }

  return {
    text: keptSentences.join("\n"),
    citations: allCitations,
    insufficient: false,
  };
}
