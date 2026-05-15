import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { DbService } from "../db/db.service";
import { EditClassifier } from "./edit-classifier";
import { StyleGuideService } from "./style-guide.service";
import { FewShotService } from "./few-shot.service";
import { RetrievalFeedbackService } from "./retrieval-feedback.service";
import {
  CASE_FACT_SECTIONS,
  SECTION_LABELS,
  type CaseFactSection,
} from "../sections";
import type { Citation, DraftSection, EditType } from "../types";

interface DraftRow {
  id: string;
  case_id: string;
  sections: DraftSection[];
  citations: Citation[];
}

@Injectable()
export class LearningService {
  private readonly log = new Logger(LearningService.name);

  constructor(
    private readonly db: DbService,
    private readonly classifier: EditClassifier,
    private readonly styleGuide: StyleGuideService,
    private readonly fewShot: FewShotService,
    private readonly retrievalFeedback: RetrievalFeedbackService,
  ) {}

  // The single entry point fired on `PATCH /drafts/:id`.
  // Returns the updated draft so the UI can refresh.
  async handleEdit(
    draftId: string,
    edited: { key: string; text: string }[],
  ): Promise<DraftRow> {
    const draft = await this.loadDraft(draftId);

    // Persist edited text on the draft first; if classification dies, the
    // operator's work is still saved.
    const editedByKey = new Map(edited.map((e) => [e.key, e.text]));
    const newSections: DraftSection[] = draft.sections.map((s) => {
      const newText = editedByKey.get(s.key);
      return newText === undefined ? s : { ...s, text: newText };
    });
    await this.db.query(
      `UPDATE drafts SET sections = $2, edited = true, updated_at = now() WHERE id = $1`,
      [draftId, JSON.stringify(newSections)],
    );

    // Process each section's edit in the background-ish fashion: we await
    // them sequentially here so the operator sees the side effects (new
    // style rules etc.) on their next refresh.
    for (const oldSection of draft.sections) {
      const newText = editedByKey.get(oldSection.key);
      if (newText === undefined || newText === oldSection.text) continue;
      await this.processSectionEdit({
        caseId: draft.case_id,
        draftId,
        section: oldSection.key as CaseFactSection,
        beforeText: oldSection.text,
        afterText: newText,
        beforeCitations: oldSection.citations,
      });
    }

    return { ...draft, sections: newSections };
  }

  private async processSectionEdit(args: {
    caseId: string;
    draftId: string;
    section: CaseFactSection;
    beforeText: string;
    afterText: string;
    beforeCitations: Citation[];
  }): Promise<void> {
    const { beforeText, afterText, section } = args;
    const sectionLabel = SECTION_LABELS[section];

    // Record the section-level pair for few-shot retrieval.
    // We do this once per section (not per sentence) — the model imitates
    // section-level style, not sentence-level.
    await this.fewShot.record({
      caseId: args.caseId,
      draftId: args.draftId,
      section,
      defaultText: beforeText,
      editedText: afterText,
    });

    // Sentence-level diff. We don't use diff-match-patch character-level
    // here — semantic granularity is more useful and aligns with how the
    // drafter emits one sentence per line.
    const beforeSentences = beforeText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const afterSentences = afterText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    const pairs = alignSentences(beforeSentences, afterSentences);

    for (const pair of pairs) {
      if (pair.before === pair.after) continue;
      const cls = await this.classifier.classify({
        before: pair.before,
        after: pair.after,
        sectionLabel,
      });

      // Persist the raw event regardless of type — it's the audit trail.
      const supportingChunks =
        pair.before === ""
          ? []
          : args.beforeCitations.filter((c) => pair.before.includes(c.token)).map((c) => c.chunkId);

      await this.db.query(
        `INSERT INTO edit_events
           (draft_id, section, sentence_before, sentence_after, edit_type, supporting_chunks)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          args.draftId,
          section,
          pair.before || null,
          pair.after || null,
          cls.edit_type,
          JSON.stringify(supportingChunks),
        ],
      );

      await this.applyEditSignal({
        caseId: args.caseId,
        section,
        editType: cls.edit_type,
        before: pair.before,
        after: pair.after,
        styleRules: cls.style_rules,
        supportingChunks,
      });
    }
  }

  private async applyEditSignal(args: {
    caseId: string;
    section: CaseFactSection;
    editType: EditType;
    before: string;
    after: string;
    styleRules: { pattern: string; replacement: string; rationale: string }[];
    supportingChunks: string[];
  }): Promise<void> {
    switch (args.editType) {
      case "ADDED_FACT":
        await this.retrievalFeedback.logAddedFact({
          caseId: args.caseId,
          addedSentence: args.after,
          sectionKey: args.section,
        });
        break;

      case "REMOVED_HALLUCINATION":
        await this.retrievalFeedback.demoteCitedChunks(args.supportingChunks);
        break;

      case "REPHRASED_STYLE":
      case "TERMINOLOGY_SWAP":
        for (const rule of args.styleRules) {
          if (rule.pattern.trim().length === 0) continue;
          await this.styleGuide.addCandidate(rule);
        }
        break;

      case "CITATION_FIX":
      case "RESTRUCTURED":
      case "UNCATEGORIZED":
        // Captured for audit + future training data; no immediate side effect.
        break;
    }
  }

  private async loadDraft(id: string): Promise<DraftRow> {
    const { rows } = await this.db.query<DraftRow>(
      "SELECT id, case_id, sections, citations FROM drafts WHERE id = $1",
      [id],
    );
    if (!rows[0]) throw new NotFoundException(`draft ${id} not found`);
    return rows[0];
  }
}

// Greedy alignment: for each sentence in either list, find its best partner
// in the other by substring overlap; unmatched ones are treated as pure
// add/delete. Good enough for sentence-line drafts where most edits are
// rewrites of a single line at a time.
function alignSentences(
  before: string[],
  after: string[],
): { before: string; after: string }[] {
  const used = new Set<number>();
  const pairs: { before: string; after: string }[] = [];

  for (const b of before) {
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < after.length; i++) {
      if (used.has(i)) continue;
      const s = jaccard(b, after[i]);
      if (s > bestScore) {
        bestScore = s;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestScore > 0.2) {
      used.add(bestIdx);
      pairs.push({ before: b, after: after[bestIdx] });
    } else {
      pairs.push({ before: b, after: "" });
    }
  }
  for (let i = 0; i < after.length; i++) {
    if (!used.has(i)) pairs.push({ before: "", after: after[i] });
  }
  return pairs;
}

function jaccard(a: string, b: string): number {
  const wa = new Set(a.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
  const wb = new Set(b.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
  if (wa.size === 0 || wb.size === 0) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / (wa.size + wb.size - inter);
}
