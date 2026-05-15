// The fixed structure of a Case Fact Summary.
// Order matters — the UI renders sections in this order and the generator
// produces them in this order so later sections can cite earlier ones.
export const CASE_FACT_SECTIONS = [
  "parties",
  "procedural_posture",
  "factual_background",
  "key_documents",
  "disputed_facts",
  "open_questions",
] as const;

export type CaseFactSection = (typeof CASE_FACT_SECTIONS)[number];

export const SECTION_LABELS: Record<CaseFactSection, string> = {
  parties: "Parties",
  procedural_posture: "Procedural Posture",
  factual_background: "Factual Background",
  key_documents: "Key Documents & Evidence",
  disputed_facts: "Disputed Facts",
  open_questions: "Open Questions / Missing Information",
};

// Sub-queries fanned out into the retrieval layer per section.
// Concrete queries are better than asking the LLM "find everything relevant."
export const SECTION_SUBQUERIES: Record<CaseFactSection, string[]> = {
  parties: [
    "plaintiff defendant petitioner respondent appellant appellee",
    "party name address representation counsel",
    "corporate entity individual capacity",
  ],
  procedural_posture: [
    "complaint filed motion pleading hearing date court",
    "appeal remand stay dismissal judgment order",
    "case number docket jurisdiction venue",
  ],
  factual_background: [
    "events leading up to dispute timeline chronology",
    "date of incident occurrence transaction",
    "facts surrounding claim allegation",
  ],
  key_documents: [
    "exhibit attached annex schedule appendix",
    "contract agreement deed instrument signed executed",
    "correspondence letter email notice communication",
  ],
  disputed_facts: [
    "disagreement contention dispute denial",
    "plaintiff alleges defendant denies contests",
    "conflicting account version witness",
  ],
  open_questions: [
    "unclear unknown missing illegible redacted",
    "follow up requires verification confirmation",
    "TBD pending awaiting additional discovery",
  ],
};
