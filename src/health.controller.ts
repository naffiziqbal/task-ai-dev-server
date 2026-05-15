import { Controller, Get } from "@nestjs/common";
import { DbService } from "./db/db.service";

@Controller("health")
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Get()
  async health() {
    const row = await this.db.query<{ ok: number }>("SELECT 1 as ok");
    return {
      ok: row.rows[0]?.ok === 1,
      service: "api",
      ts: new Date().toISOString(),
    };
  }
}
