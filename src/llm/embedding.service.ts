import { Injectable, Logger } from "@nestjs/common";
import OpenAI from "openai";

const EMBEDDING_DIM = Number(process.env.EMBEDDING_DIM ?? 768);

@Injectable()
export class EmbeddingService {
  private readonly log = new Logger(EmbeddingService.name);
  private client: OpenAI | null = null;
  private readonly model =
    process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";

  private get openai(): OpenAI {
    if (!this.client) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error("OPENAI_API_KEY is not set — required for embeddings.");
      }
      this.client = new OpenAI({ apiKey });
    }
    return this.client;
  }

  // Batch defensively to keep individual requests small on large documents.
  async embedMany(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (!process.env.OPENAI_API_KEY) {
      this.log.warn(
        "OPENAI_API_KEY not set — falling back to deterministic hash embeddings. " +
          "Retrieval quality will be poor but the pipeline will run end-to-end.",
      );
      return texts.map((t) => hashEmbedding(t, EMBEDDING_DIM));
    }

    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 96) {
      const batch = texts.slice(i, i + 96);
      const response = await this.openai.embeddings.create({
        model: this.model,
        input: batch,
        // text-embedding-3-small defaults to 1536; ask for the configured
        // EMBEDDING_DIM (768 here) to match pgvector's column width.
        // Matryoshka-style truncation preserves most quality.
        dimensions: EMBEDDING_DIM,
      });
      if (response.data.length !== batch.length) {
        throw new Error(
          `OpenAI embed returned ${response.data.length} vectors for ${batch.length} inputs`,
        );
      }
      for (const item of response.data) {
        const v = item.embedding as number[];
        // OpenAI normalizes when dimensions=default; with custom dimensions
        // re-normalization is recommended so cosine distance stays well-behaved.
        l2NormalizeInPlace(v);
        out.push(v);
      }
    }
    return out;
  }

  async embed(text: string): Promise<number[]> {
    const [v] = await this.embedMany([text]);
    return v;
  }
}

function l2NormalizeInPlace(v: number[]): void {
  let sq = 0;
  for (const x of v) sq += x * x;
  const n = Math.sqrt(sq);
  if (n === 0) return;
  for (let i = 0; i < v.length; i++) v[i] /= n;
}

// Deterministic, low-quality fallback so the pipeline is testable without
// an API key. Not for production retrieval.
function hashEmbedding(text: string, dim: number): number[] {
  const out = new Array(dim).fill(0);
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    const idx = (ch * 2654435761 + i) % dim;
    out[idx] += 1;
  }
  let norm = 0;
  for (const v of out) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return out.map((v) => v / norm);
}
