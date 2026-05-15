import { Injectable, Logger } from "@nestjs/common";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface OcrResult {
  text: string;
  // Mean confidence across all recognized words, 0-100. Tesseract emits
  // per-word confidence; we average. -1 means "no words recognized."
  meanConfidence: number;
}

@Injectable()
export class OcrService {
  private readonly log = new Logger(OcrService.name);

  // Run Tesseract on a PNG buffer. We invoke the binary directly via TSV
  // output so we get per-word confidence — node-tesseract-ocr discards it.
  async recognize(png: Buffer): Promise<OcrResult> {
    const workDir = join(tmpdir(), `psl-ocr-${randomUUID()}`);
    await fs.mkdir(workDir, { recursive: true });
    const imagePath = join(workDir, "page.png");
    const outBase = join(workDir, "out");

    try {
      await fs.writeFile(imagePath, png);
      // --psm 6: "Assume a single uniform block of text." Good default for
      // scanned pages. -l eng: English traineddata (ships with the container).
      // tsv output gives us confidence per word.
      await execFileAsync("tesseract", [
        imagePath,
        outBase,
        "-l",
        "eng",
        "--psm",
        "6",
        "tsv",
      ]);

      const tsv = await fs.readFile(`${outBase}.tsv`, "utf8");
      return parseTesseractTsv(tsv);
    } catch (err) {
      this.log.error(`tesseract failed: ${(err as Error).message}`);
      return { text: "", meanConfidence: -1 };
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function parseTesseractTsv(tsv: string): OcrResult {
  const lines = tsv.split("\n").slice(1).filter((l) => l.trim().length > 0);
  const words: string[] = [];
  const confidences: number[] = [];

  // Track line breaks via Tesseract's hierarchy fields so we preserve
  // paragraph structure rather than mashing everything onto one line.
  let lastBlock = -1;
  let lastPara = -1;
  let lastLine = -1;
  const tokens: string[] = [];

  for (const line of lines) {
    const cols = line.split("\t");
    if (cols.length < 12) continue;
    const level = Number(cols[0]);
    if (level !== 5) continue; // only word-level rows
    const block = Number(cols[2]);
    const para = Number(cols[3]);
    const lineIdx = Number(cols[4]);
    const conf = Number(cols[10]);
    const word = cols[11];

    if (!word) continue;
    if (Number.isFinite(conf) && conf >= 0) confidences.push(conf);
    words.push(word);

    if (lastLine !== -1 && (block !== lastBlock || para !== lastPara)) {
      tokens.push("\n\n");
    } else if (lastLine !== -1 && lineIdx !== lastLine) {
      tokens.push("\n");
    } else if (tokens.length > 0) {
      tokens.push(" ");
    }
    tokens.push(word);
    lastBlock = block;
    lastPara = para;
    lastLine = lineIdx;
  }

  const meanConfidence =
    confidences.length === 0
      ? -1
      : confidences.reduce((s, v) => s + v, 0) / confidences.length;

  return { text: tokens.join("").trim(), meanConfidence };
}
