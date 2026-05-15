import { Injectable } from "@nestjs/common";
import { DbService } from "../db/db.service";
import { EmbeddingService } from "../llm/embedding.service";

export interface ChunkSeed {
  documentId: string;
  pageId: string;
  pageNumber: number;
  text: string;
  charStart: number;
  charEnd: number;
}

// ~500 tokens ≈ ~2000 chars for English. Overlap 200 chars (~50 tokens).
const TARGET_CHARS = 2000;
const OVERLAP = 200;

@Injectable()
export class ChunkService {
  constructor(
    private readonly db: DbService,
    private readonly embed: EmbeddingService,
  ) {}

  // Split a single page into windowed chunks, preserving char offsets so
  // we can highlight the cited span in the UI later.
  chunkPage(args: { documentId: string; pageId: string; pageNumber: number; text: string }): ChunkSeed[] {
    const { documentId, pageId, pageNumber, text } = args;
    const t = text;
    const chunks: ChunkSeed[] = [];
    if (t.trim().length === 0) return chunks;

    let i = 0;
    while (i < t.length) {
      const end = Math.min(i + TARGET_CHARS, t.length);
      // Try to break on a paragraph or sentence boundary near `end`.
      let cut = end;
      if (end < t.length) {
        const window = t.slice(end - 200, end + 50);
        const para = window.lastIndexOf("\n\n");
        const sent = window.search(/[.!?]\s/);
        if (para >= 0) cut = end - 200 + para + 2;
        else if (sent >= 0) cut = end - 200 + sent + 1;
      }
      chunks.push({
        documentId,
        pageId,
        pageNumber,
        text: t.slice(i, cut).trim(),
        charStart: i,
        charEnd: cut,
      });
      if (cut >= t.length) break;
      i = Math.max(cut - OVERLAP, i + 1);
    }
    return chunks;
  }

  // Embed + persist a batch of chunks for one document.
  async persist(seeds: ChunkSeed[]): Promise<void> {
    if (seeds.length === 0) return;
    const vectors = await this.embed.embedMany(seeds.map((s) => s.text));

    await this.db.tx(async (q) => {
      for (let i = 0; i < seeds.length; i++) {
        const s = seeds[i];
        const v = vectors[i];
        await q(
          `INSERT INTO chunks
             (document_id, page_id, page_number, text, char_start, char_end, embedding, tsv)
           VALUES ($1, $2, $3, $4, $5, $6, $7::vector, to_tsvector('english', $4))`,
          [
            s.documentId,
            s.pageId,
            s.pageNumber,
            s.text,
            s.charStart,
            s.charEnd,
            vectorLiteral(v),
          ],
        );
      }
    });
  }
}

// pgvector wants a textual literal like "[0.1,0.2,...]"
function vectorLiteral(v: number[]): string {
  return `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(6) : "0")).join(",")}]`;
}
