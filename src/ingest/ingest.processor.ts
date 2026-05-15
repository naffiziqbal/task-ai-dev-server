import { Injectable, Logger } from "@nestjs/common";
import { DbService } from "../db/db.service";
import { StorageService } from "../storage/storage.service";
import { OcrService } from "./ocr.service";
import { PdfService } from "./pdf.service";
import { ExtractService } from "./extract.service";
import { ChunkService } from "./chunk.service";
import type { IngestJobData } from "../queue/queue.service";

// Threshold below which a page's OCR is considered low-confidence and the
// document gets a warning badge in the UI. Tesseract emits 0-100; words
// at 60 are recognizable-but-shaky in our calibration.
const LOW_CONFIDENCE_THRESHOLD = 60;

// If a PDF page has at least this many extractable characters via pdf-parse,
// trust the native text layer and skip OCR for that page.
const NATIVE_TEXT_MIN_CHARS = 80;

@Injectable()
export class IngestProcessor {
  private readonly log = new Logger(IngestProcessor.name);

  constructor(
    private readonly db: DbService,
    private readonly storage: StorageService,
    private readonly pdf: PdfService,
    private readonly ocr: OcrService,
    private readonly extract: ExtractService,
    private readonly chunks: ChunkService,
  ) {}

  async handle(job: IngestJobData): Promise<void> {
    const { documentId } = job;
    this.log.log(`ingest start doc=${documentId}`);
    try {
      await this.setStatus(documentId, "ocr");
      await this.resetProgress(documentId);
      const doc = await this.loadDocument(documentId);
      const blob = await this.storage.getBuffer(doc.blob_key);
      const mime = doc.mime ?? "";

      const pages = await this.extractPages(documentId, blob, mime);
      const meanConfidence = computeMeanConfidence(pages);

      await this.db.query(
        `UPDATE documents
           SET page_count = $2, mean_ocr_confidence = $3, updated_at = now()
         WHERE id = $1`,
        [documentId, pages.length, meanConfidence],
      );

      // Structured extraction.
      await this.setStatus(documentId, "extracted");
      const payload = await this.extract.extract(
        pages.map((p) => ({ pageNumber: p.pageNumber, text: p.text })),
      );
      await this.db.query(
        `INSERT INTO extractions (document_id, schema_version, payload)
         VALUES ($1, 'v1', $2)`,
        [documentId, payload],
      );
      if (payload.document_type) {
        await this.db.query(
          `UPDATE documents SET document_type = $2 WHERE id = $1`,
          [documentId, payload.document_type],
        );
      }

      // Chunk + embed.
      const seeds = pages.flatMap((p) =>
        this.chunks.chunkPage({
          documentId,
          pageId: p.pageId,
          pageNumber: p.pageNumber,
          text: p.text,
        }),
      );
      await this.chunks.persist(seeds);

      await this.setStatus(documentId, "indexed");
      this.log.log(
        `ingest done doc=${documentId} pages=${pages.length} chunks=${seeds.length} conf=${meanConfidence.toFixed(1)}`,
      );
    } catch (err) {
      this.log.error(`ingest failed doc=${documentId}: ${(err as Error).message}`);
      await this.db.query(
        `UPDATE documents SET status = 'failed', error = $2, updated_at = now()
         WHERE id = $1`,
        [documentId, (err as Error).message.slice(0, 1000)],
      );
      throw err;
    }
  }

  private async setStatus(id: string, status: string): Promise<void> {
    await this.db.query(
      `UPDATE documents SET status = $2, updated_at = now() WHERE id = $1`,
      [id, status],
    );
  }

  private async resetProgress(id: string): Promise<void> {
    await this.db.query(
      `UPDATE documents SET pages_done = 0, pages_total = NULL,
                            updated_at = now()
         WHERE id = $1`,
      [id],
    );
  }

  private async setPagesTotal(id: string, total: number): Promise<void> {
    await this.db.query(
      `UPDATE documents SET pages_total = $2, updated_at = now() WHERE id = $1`,
      [id, total],
    );
  }

  private async bumpPagesDone(id: string): Promise<void> {
    await this.db.query(
      `UPDATE documents
         SET pages_done = COALESCE(pages_done, 0) + 1, updated_at = now()
       WHERE id = $1`,
      [id],
    );
  }

  private async loadDocument(id: string) {
    const { rows } = await this.db.query<{
      id: string;
      blob_key: string;
      mime: string | null;
    }>("SELECT id, blob_key, mime FROM documents WHERE id = $1", [id]);
    if (!rows[0]) throw new Error(`document ${id} disappeared mid-ingest`);
    return rows[0];
  }

  // Extract per-page text + persist page rows (and image blobs for scans).
  // Returns the page rows we just wrote, with their generated UUIDs.
  private async extractPages(
    documentId: string,
    blob: Buffer,
    mime: string,
  ): Promise<{ pageId: string; pageNumber: number; text: string; confidence: number }[]> {
    if (mime === "application/pdf" || mime === "") {
      return this.extractPagesFromPdf(documentId, blob);
    }
    if (mime.startsWith("image/")) {
      return this.extractPagesFromImage(documentId, blob);
    }
    if (mime === "text/plain") {
      return this.extractPagesFromText(documentId, blob);
    }
    throw new Error(`unsupported mime type: ${mime}`);
  }

  private async extractPagesFromPdf(documentId: string, blob: Buffer) {
    const native = await this.pdf.extractNativeText(blob);
    const images = await this.pdf.renderPages(blob);
    const pageCount = Math.max(native.length, images.length);
    await this.setPagesTotal(documentId, pageCount);

    const out: { pageId: string; pageNumber: number; text: string; confidence: number }[] = [];
    for (let i = 1; i <= pageCount; i++) {
      const nativeText = native.find((n) => n.pageNumber === i)?.text ?? "";
      const image = images.find((img) => img.pageNumber === i);
      let text = nativeText;
      let confidence = 100; // Native text — treat as fully confident.
      let imageKey: string | null = null;

      // Need OCR if native text is too sparse and we have a rendered image.
      if (text.length < NATIVE_TEXT_MIN_CHARS && image) {
        const ocrResult = await this.ocr.recognize(image.pngBuffer);
        text = ocrResult.text;
        confidence = ocrResult.meanConfidence;
      }

      if (image) {
        imageKey = `cases/_/documents/${documentId}/pages/${i}.png`;
        await this.storage.putBuffer(imageKey, image.pngBuffer, "image/png");
      }

      const pageId = await this.insertPage(documentId, i, text, confidence, imageKey);
      out.push({ pageId, pageNumber: i, text, confidence });
      await this.bumpPagesDone(documentId);
    }
    return out;
  }

  private async extractPagesFromImage(documentId: string, blob: Buffer) {
    await this.setPagesTotal(documentId, 1);
    const ocrResult = await this.ocr.recognize(blob);
    const imageKey = `cases/_/documents/${documentId}/pages/1.png`;
    await this.storage.putBuffer(imageKey, blob, "image/png");
    const pageId = await this.insertPage(
      documentId,
      1,
      ocrResult.text,
      ocrResult.meanConfidence,
      imageKey,
    );
    await this.bumpPagesDone(documentId);
    return [
      {
        pageId,
        pageNumber: 1,
        text: ocrResult.text,
        confidence: ocrResult.meanConfidence,
      },
    ];
  }

  private async extractPagesFromText(documentId: string, blob: Buffer) {
    const text = blob.toString("utf8");
    // Paginate plain text at ~3000 chars so retrieval citations are meaningful.
    const pages: string[] = [];
    for (let i = 0; i < text.length; i += 3000) {
      pages.push(text.slice(i, i + 3000));
    }
    await this.setPagesTotal(documentId, pages.length);
    const out: { pageId: string; pageNumber: number; text: string; confidence: number }[] = [];
    for (let i = 0; i < pages.length; i++) {
      const pageId = await this.insertPage(documentId, i + 1, pages[i], 100, null);
      out.push({ pageId, pageNumber: i + 1, text: pages[i], confidence: 100 });
      await this.bumpPagesDone(documentId);
    }
    return out;
  }

  private async insertPage(
    documentId: string,
    pageNumber: number,
    text: string,
    confidence: number,
    imageKey: string | null,
  ): Promise<string> {
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO pages (document_id, page_number, text, ocr_confidence, image_key)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (document_id, page_number)
         DO UPDATE SET text = EXCLUDED.text,
                       ocr_confidence = EXCLUDED.ocr_confidence,
                       image_key = EXCLUDED.image_key
       RETURNING id`,
      [documentId, pageNumber, text, confidence, imageKey],
    );
    return rows[0].id;
  }
}

function computeMeanConfidence(
  pages: { confidence: number }[],
): number {
  const usable = pages.filter((p) => p.confidence >= 0);
  if (usable.length === 0) return -1;
  return usable.reduce((s, p) => s + p.confidence, 0) / usable.length;
}

export { LOW_CONFIDENCE_THRESHOLD };
