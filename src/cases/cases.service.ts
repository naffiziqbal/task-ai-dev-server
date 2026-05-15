import { Injectable, NotFoundException } from "@nestjs/common";
import { DbService } from "../db/db.service";

export interface CaseRow {
  id: string;
  name: string;
  created_at: string;
}

@Injectable()
export class CasesService {
  constructor(private readonly db: DbService) {}

  async list(): Promise<CaseRow[]> {
    const { rows } = await this.db.query<CaseRow>(
      "SELECT id, name, created_at FROM cases ORDER BY created_at DESC",
    );
    return rows;
  }

  async create(name: string): Promise<CaseRow> {
    const { rows } = await this.db.query<CaseRow>(
      "INSERT INTO cases (name) VALUES ($1) RETURNING id, name, created_at",
      [name],
    );
    return rows[0];
  }

  async get(id: string): Promise<CaseRow> {
    const { rows } = await this.db.query<CaseRow>(
      "SELECT id, name, created_at FROM cases WHERE id = $1",
      [id],
    );
    if (rows.length === 0) throw new NotFoundException(`case ${id} not found`);
    return rows[0];
  }
}
