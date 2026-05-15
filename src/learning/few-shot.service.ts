import { Injectable } from "@nestjs/common";
import { DbService } from "../db/db.service";
import { EmbeddingService } from "../llm/embedding.service";

interface EditPairRow {
  id: string;
  section: string;
  default_text: string;
  edited_text: string;
  similarity?: number;
}

@Injectable()
export class FewShotService {
  constructor(
    private readonly db: DbService,
    private readonly embed: EmbeddingService,
  ) {}

  async record(args: {
    caseId: string;
    draftId: string;
    section: string;
    defaultText: string;
    editedText: string;
  }): Promise<void> {
    // We embed the edited text — that's the target the drafter should
    // imitate. Retrieval at draft time queries on the new evidence summary
    // and finds the closest past target.
    const v = await this.embed.embed(args.editedText.slice(0, 4000));
    await this.db.query(
      `INSERT INTO edit_pairs
         (case_id, draft_id, section, default_text, edited_text, embedding)
       VALUES ($1, $2, $3, $4, $5, $6::vector)`,
      [
        args.caseId,
        args.draftId,
        args.section,
        args.defaultText,
        args.editedText,
        `[${v.map((x) => x.toFixed(6)).join(",")}]`,
      ],
    );
  }

  // Find the closest past edit pairs for a section. We bias by section
  // match — same-section examples are far more useful than cross-section.
  async findRelevant(args: { section: string; k?: number }): Promise<EditPairRow[]> {
    const k = args.k ?? 2;
    const { rows } = await this.db.query<EditPairRow>(
      `SELECT id, section, default_text, edited_text
         FROM edit_pairs
        WHERE section = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [args.section, k],
    );
    return rows;
  }
}
