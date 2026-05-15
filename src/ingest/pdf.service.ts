import { Injectable, Logger } from "@nestjs/common";
import { fromBuffer } from "pdf2pic";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// pdf-parse has no types in npm; declared in src/types/pdf-parse.d.ts.
import pdfParse from "pdf-parse";

export interface PageImage {
  pageNumber: number;
  pngBuffer: Buffer;
}

export interface NativeTextPage {
  pageNumber: number;
  text: string;
}

@Injectable()
export class PdfService {
  private readonly log = new Logger(PdfService.name);

  // Render every page of a PDF to a PNG buffer at 200 DPI.
  // 200 is a Tesseract sweet spot — high enough for OCR, low enough that
  // a 50-page scan doesn't OOM the worker.
  async renderPages(pdf: Buffer): Promise<PageImage[]> {
    const workDir = join(tmpdir(), `psl-pdf-${randomUUID()}`);
    await fs.mkdir(workDir, { recursive: true });
    try {
      const convert = fromBuffer(pdf, {
        density: 200,
        format: "png",
        width: 1700,
        height: 2200,
        savePath: workDir,
      });
      const all = (await convert.bulk(-1, { responseType: "buffer" })) as Array<{
        page: number;
        buffer?: Buffer;
      }>;
      return all
        .filter((p) => Buffer.isBuffer(p.buffer))
        .map((p) => ({ pageNumber: p.page, pngBuffer: p.buffer as Buffer }));
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // Extract native text when the PDF actually has a text layer.
  // Returns per-page text; empty string for pages without extractable text.
  async extractNativeText(pdf: Buffer): Promise<NativeTextPage[]> {
    try {
      const data = await pdfParse(pdf);
      // pdf-parse joins all pages with form-feed (\f). Split honors that.
      const pages = data.text.split("\f");
      return pages.map((text, i) => ({ pageNumber: i + 1, text: text.trim() }));
    } catch (err) {
      this.log.warn(`pdf-parse failed, will rely on OCR: ${(err as Error).message}`);
      return [];
    }
  }
}
