import type { CaseFactSection } from "./sections";

export type DocumentStatus =
  | "pending"
  | "ocr"
  | "extracted"
  | "indexed"
  | "failed";

export type EditType =
  | "ADDED_FACT"
  | "REMOVED_HALLUCINATION"
  | "REPHRASED_STYLE"
  | "RESTRUCTURED"
  | "CITATION_FIX"
  | "TERMINOLOGY_SWAP"
  | "UNCATEGORIZED";

export interface Citation {
  // The token the model emitted in-line, e.g. "[d:abc123:5]".
  // Verbose enough to parse cleanly, short enough not to dominate output.
  token: string;
  chunkId: string;
  documentId: string;
  pageNumber: number;
  charStart: number;
  charEnd: number;
}

export interface DraftSection {
  key: CaseFactSection;
  label: string;
  text: string;
  citations: Citation[];
  insufficientEvidence: boolean;
}

export interface DraftPayload {
  id: string;
  caseId: string;
  version: number;
  sections: DraftSection[];
  generatedAt: string;
  edited: boolean;
}

export interface RetrievedPassage {
  chunkId: string;
  documentId: string;
  filename: string;
  pageNumber: number;
  text: string;
  charStart: number;
  charEnd: number;
  vectorScore: number;
  bm25Score: number;
  fusedScore: number;
}
