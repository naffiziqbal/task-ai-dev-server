import type { RetrievedPassage } from "../types";

// Citation token format. Verbose enough for the parser to recover without
// false matches, short enough not to dominate generated tokens.
// Example: [c:c0a8...]
export const CITATION_RE = /\[c:([a-f0-9-]{8,})\]/g;

export const DRAFT_SYSTEM = `You are drafting a section of a Case Fact Summary for a legal team.
You will receive EVIDENCE: a numbered list of passages from the underlying documents.
You must obey these rules without exception:

1. Every sentence you write MUST end with at least one citation token of the form [c:<chunk_id>].
   The <chunk_id> must match one of the chunk IDs in the supplied evidence. Do not invent IDs.
2. State only what the cited evidence supports. Do not introduce facts not present in the evidence.
3. If the evidence is insufficient to write the section, output the exact line:
   INSUFFICIENT EVIDENCE: <one sentence stating what is missing>
   and stop.
4. Use a sober, professional tone consistent with the provided STYLE GUIDE (if any).
5. Do not include headings, bullet markers, or quotation marks unless they appear naturally inside a sentence.
6. Each sentence is one line. Separate sentences with a single newline.
`;

export function formatEvidence(passages: RetrievedPassage[]): string {
  return passages
    .map(
      (p, i) =>
        `[${i + 1}] (chunk_id=${p.chunkId}, document=${p.filename}, page=${p.pageNumber})\n${p.text}`,
    )
    .join("\n\n");
}

export function formatFewShot(
  pairs: { section: string; default_text: string; edited_text: string }[],
): string {
  if (pairs.length === 0) return "";
  return (
    `Below are recent operator rewrites. Treat them as authoritative style + ` +
    `structure guidance. Do NOT copy their facts — only their phrasing, ` +
    `tone, and structure.\n\n` +
    pairs
      .map(
        (p, i) =>
          `--- example ${i + 1} (section: ${p.section}) ---\n` +
          `DEFAULT (model output):\n${p.default_text}\n\n` +
          `OPERATOR REWROTE TO:\n${p.edited_text}`,
      )
      .join("\n\n")
  );
}
