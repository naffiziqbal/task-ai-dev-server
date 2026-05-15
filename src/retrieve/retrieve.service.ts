import { Injectable } from "@nestjs/common";
import { DbService } from "../db/db.service";
import { EmbeddingService } from "../llm/embedding.service";
import type { RetrievedPassage } from "../types";

interface RawHit {
  chunk_id: string;
  document_id: string;
  filename: string;
  page_number: number;
  text: string;
  char_start: number;
  char_end: number;
  score: number;
  trust_score: number;
}

@Injectable()
export class RetrieveService {
  constructor(
    private readonly db: DbService,
    private readonly embed: EmbeddingService,
  ) {}

  // Hybrid retrieval scoped to a single case.
  //   1. Vector top-K by cosine distance (pgvector <=> operator).
  //   2. BM25-ish top-K via Postgres full-text ts_rank_cd over `tsv`.
  //   3. Reciprocal-rank-fuse the two lists, then multiply by chunk trust
  //      to demote chunks that previous edits flagged as hallucination sources.
  async retrieve(args: {
    caseId: string;
    query: string;
    k?: number;
  }): Promise<RetrievedPassage[]> {
    const { caseId, query } = args;
    const k = args.k ?? 15;
    const candidates = 30;

    const vector = await this.embed.embed(query);
    const vectorLit = `[${vector.map((x) => x.toFixed(6)).join(",")}]`;

    const vectorHits = await this.db.query<RawHit>(
      `SELECT c.id          AS chunk_id,
              c.document_id,
              d.filename,
              c.page_number,
              c.text,
              c.char_start,
              c.char_end,
              1 - (c.embedding <=> $2::vector) AS score,
              c.trust_score
         FROM chunks c
         JOIN documents d ON d.id = c.document_id
        WHERE d.case_id = $1
          AND c.embedding IS NOT NULL
        ORDER BY c.embedding <=> $2::vector
        LIMIT $3`,
      [caseId, vectorLit, candidates],
    );

    const bm25Hits = await this.db.query<RawHit>(
      `SELECT c.id          AS chunk_id,
              c.document_id,
              d.filename,
              c.page_number,
              c.text,
              c.char_start,
              c.char_end,
              ts_rank_cd(c.tsv, plainto_tsquery('english', $2)) AS score,
              c.trust_score
         FROM chunks c
         JOIN documents d ON d.id = c.document_id
        WHERE d.case_id = $1
          AND c.tsv @@ plainto_tsquery('english', $2)
        ORDER BY score DESC
        LIMIT $3`,
      [caseId, query, candidates],
    );

    return fuseRrf(vectorHits.rows, bm25Hits.rows, k);
  }

  // Fan out: run a list of sub-queries and dedup by chunk, keeping the
  // best fused score per chunk. Used by the drafter (one set of sub-queries
  // per Case Fact Summary section).
  async retrieveMany(args: {
    caseId: string;
    queries: string[];
    perQueryK?: number;
    finalK?: number;
  }): Promise<RetrievedPassage[]> {
    const perQueryK = args.perQueryK ?? 8;
    const finalK = args.finalK ?? 20;
    const byChunk = new Map<string, RetrievedPassage>();
    for (const q of args.queries) {
      const hits = await this.retrieve({
        caseId: args.caseId,
        query: q,
        k: perQueryK,
      });
      for (const h of hits) {
        const prev = byChunk.get(h.chunkId);
        if (!prev || h.fusedScore > prev.fusedScore) byChunk.set(h.chunkId, h);
      }
    }
    return [...byChunk.values()]
      .sort((a, b) => b.fusedScore - a.fusedScore)
      .slice(0, finalK);
  }
}

function fuseRrf(
  vectorRows: RawHit[],
  bm25Rows: RawHit[],
  k: number,
): RetrievedPassage[] {
  const C = 60; // standard RRF constant
  const scores = new Map<
    string,
    { row: RawHit; vectorScore: number; bm25Score: number; rrf: number }
  >();
  vectorRows.forEach((row, idx) => {
    scores.set(row.chunk_id, {
      row,
      vectorScore: row.score,
      bm25Score: 0,
      rrf: 1 / (C + idx + 1),
    });
  });
  bm25Rows.forEach((row, idx) => {
    const cur = scores.get(row.chunk_id);
    if (cur) {
      cur.bm25Score = row.score;
      cur.rrf += 1 / (C + idx + 1);
    } else {
      scores.set(row.chunk_id, {
        row,
        vectorScore: 0,
        bm25Score: row.score,
        rrf: 1 / (C + idx + 1),
      });
    }
  });
  return [...scores.values()]
    .map((s) => ({
      chunkId: s.row.chunk_id,
      documentId: s.row.document_id,
      filename: s.row.filename,
      pageNumber: s.row.page_number,
      text: s.row.text,
      charStart: s.row.char_start,
      charEnd: s.row.char_end,
      vectorScore: s.vectorScore,
      bm25Score: s.bm25Score,
      // Trust-weighted: chunks marked low-trust by prior REMOVED_HALLUCINATION
      // edits are demoted here at retrieval time.
      fusedScore: s.rrf * Number(s.row.trust_score ?? 1),
    }))
    .sort((a, b) => b.fusedScore - a.fusedScore)
    .slice(0, k);
}
