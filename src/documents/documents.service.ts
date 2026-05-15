import { Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import { DbService } from "../db/db.service";
import { StorageService } from "../storage/storage.service";
import { QueueService } from "../queue/queue.service";
import { randomUUID } from "node:crypto";

export interface DocumentRow {
  id: string;
  case_id: string;
  filename: string;
  mime: string | null;
  blob_key: string;
  status: string;
  page_count: number | null;
  pages_done: number | null;
  pages_total: number | null;
  mean_ocr_confidence: number | null;
  document_type: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface PageRow {
  id: string;
  document_id: string;
  page_number: number;
  text: string | null;
  ocr_confidence: number | null;
  image_key: string | null;
}

@Injectable()
export class DocumentsService implements OnModuleInit {
  constructor(
    private readonly db: DbService,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
  ) {}

  async onModuleInit() {
    // Progress-tracking columns. Idempotent — init.sql also has them for
    // fresh volumes; this covers existing dev DBs.
    await this.db.query(
      `ALTER TABLE documents
         ADD COLUMN IF NOT EXISTS pages_done  INTEGER,
         ADD COLUMN IF NOT EXISTS pages_total INTEGER`,
    );
  }

  async upload(
    caseId: string,
    file: Express.Multer.File,
  ): Promise<DocumentRow> {
    const id = randomUUID();
    const blobKey = `cases/${caseId}/documents/${id}/${file.originalname}`;
    await this.storage.putBuffer(blobKey, file.buffer, file.mimetype);

    const { rows } = await this.db.query<DocumentRow>(
      `INSERT INTO documents (id, case_id, filename, mime, blob_key, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING *`,
      [id, caseId, file.originalname, file.mimetype, blobKey],
    );

    await this.queue.enqueueIngest({ documentId: id, caseId });

    return rows[0];
  }

  async listByCase(caseId: string): Promise<DocumentRow[]> {
    const { rows } = await this.db.query<DocumentRow>(
      "SELECT * FROM documents WHERE case_id = $1 ORDER BY created_at DESC",
      [caseId],
    );
    return rows;
  }

  async get(id: string): Promise<DocumentRow> {
    const { rows } = await this.db.query<DocumentRow>(
      "SELECT * FROM documents WHERE id = $1",
      [id],
    );
    if (!rows[0]) throw new NotFoundException(`document ${id} not found`);
    return rows[0];
  }

  async getPage(documentId: string, pageNumber: number): Promise<{
    page: PageRow;
    imageUrl: string | null;
  }> {
    const { rows } = await this.db.query<PageRow>(
      "SELECT * FROM pages WHERE document_id = $1 AND page_number = $2",
      [documentId, pageNumber],
    );
    if (!rows[0]) {
      throw new NotFoundException(
        `page ${pageNumber} not found for document ${documentId}`,
      );
    }
    const page = rows[0];
    const imageUrl = page.image_key
      ? await this.storage.presignGet(page.image_key, 3600)
      : null;
    return { page, imageUrl };
  }
}
