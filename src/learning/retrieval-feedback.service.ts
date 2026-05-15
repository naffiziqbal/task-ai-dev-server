import { Injectable, Logger } from "@nestjs/common";
import { DbService } from "../db/db.service";
import { EmbeddingService } from "../llm/embedding.service";

// When this similarity is exceeded we consider the operator's added
// sentence to have a matching chunk that retrieval should have surfaced.
const RETRIEVAL_MATCH_THRESHOLD = 0.55;

// How much we demote a chunk's trust_score for each REMOVED_HALLUCINATION
// edit that cited it. Bounded at 0.1 minimum so we never zero out a chunk.
const TRUST_PENALTY = 0.25;

@Injectable()
export class RetrievalFeedbackService {
  private readonly log = new Logger(RetrievalFeedbackService.name);

  constructor(
    private readonly db: DbService,
    private readonly embed: EmbeddingService,
  ) {}

  // ADDED_FACT signal. Did retrieval miss a chunk that actually exists?
  async logAddedFact(args: {
    caseId: string;
    addedSentence: string;
    sectionKey: string;
  }): Promise<void> {
    if (args.addedSentence.trim().length < 5) return;
    const v = await this.embed.embed(args.addedSentence);
    const lit = `[${v.map((x) => x.toFixed(6)).join(",")}]`;

    const { rows } = await this.db.query<{
      id: string;
      similarity: number;
    }>(
      `SELECT c.id, 1 - (c.embedding <=> $2::vector) AS similarity
         FROM chunks c
         JOIN documents d ON d.id = c.document_id
        WHERE d.case_id = $1
        ORDER BY c.embedding <=> $2::vector
        LIMIT 1`,
      [args.caseId, lit],
    );

    if (!rows[0] || rows[0].similarity < RETRIEVAL_MATCH_THRESHOLD) {
      this.log.log(
        `ADDED_FACT for case=${args.caseId} has no matching chunk (max sim ${rows[0]?.similarity?.toFixed(2) ?? "n/a"}). Likely missing source.`,
      );
      return;
    }

    await this.db.query(
      `INSERT INTO retrieval_misses (case_id, missed_chunk_id, added_sentence, query_sub_topic)
       VALUES ($1, $2, $3, $4)`,
      [args.caseId, rows[0].id, args.addedSentence, args.sectionKey],
    );
    this.log.log(
      `retrieval_miss logged: chunk=${rows[0].id} sim=${rows[0].similarity.toFixed(2)} section=${args.sectionKey}`,
    );
  }

  // REMOVED_HALLUCINATION signal. Demote the chunks the deleted sentence
  // cited so they're less likely to be retrieved next time.
  async demoteCitedChunks(chunkIds: string[]): Promise<void> {
    if (chunkIds.length === 0) return;
    await this.db.query(
      `UPDATE chunks
          SET trust_score = GREATEST(0.1, trust_score - $2)
        WHERE id = ANY($1::uuid[])`,
      [chunkIds, TRUST_PENALTY],
    );
    this.log.log(`demoted trust on ${chunkIds.length} chunks by ${TRUST_PENALTY}`);
  }
}
