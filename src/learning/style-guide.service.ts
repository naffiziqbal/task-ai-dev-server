import { Injectable, Logger } from "@nestjs/common";
import { DbService } from "../db/db.service";
import { LlmService } from "../llm/llm.service";

// Trigger a synthesis pass whenever the rule set grows by this many
// approved-but-not-yet-synthesized rules. Small enough to see signal
// during a demo; large enough to avoid synthesizing on every edit.
const SYNTHESIS_THRESHOLD = 3;

@Injectable()
export class StyleGuideService {
  private readonly log = new Logger(StyleGuideService.name);
  private rulesSinceLastSynthesis = 0;

  constructor(
    private readonly db: DbService,
    private readonly llm: LlmService,
  ) {}

  async get(): Promise<string> {
    const { rows } = await this.db.query<{ content: string }>(
      "SELECT content FROM style_guide WHERE id = 1",
    );
    return rows[0]?.content ?? "";
  }

  // Upsert a candidate rule. Same (pattern, replacement) bumps frequency.
  async addCandidate(args: {
    pattern: string;
    replacement: string;
    rationale: string;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO style_rules (pattern, replacement, rationale, frequency)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT DO NOTHING`,
      [args.pattern.trim(), args.replacement.trim(), args.rationale.trim()],
    );
    // The ON CONFLICT DO NOTHING above relies on a unique index; if it
    // doesn't fire we fall back to a frequency bump.
    await this.db.query(
      `UPDATE style_rules
          SET frequency = frequency + 1, last_seen = now()
        WHERE pattern = $1 AND replacement = $2 AND disabled = false`,
      [args.pattern.trim(), args.replacement.trim()],
    );
    this.rulesSinceLastSynthesis += 1;
    if (this.rulesSinceLastSynthesis >= SYNTHESIS_THRESHOLD) {
      this.rulesSinceLastSynthesis = 0;
      await this.synthesize().catch((err) =>
        this.log.warn(`style synthesis failed: ${(err as Error).message}`),
      );
    }
  }

  async listRules() {
    const { rows } = await this.db.query(
      `SELECT id, pattern, replacement, rationale, frequency, approved, disabled,
              last_seen, created_at
         FROM style_rules
         WHERE disabled = false
         ORDER BY frequency DESC, last_seen DESC`,
    );
    return rows;
  }

  async setRuleStatus(id: string, patch: { approved?: boolean; disabled?: boolean }) {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.approved !== undefined) {
      values.push(patch.approved);
      fields.push(`approved = $${values.length}`);
    }
    if (patch.disabled !== undefined) {
      values.push(patch.disabled);
      fields.push(`disabled = $${values.length}`);
    }
    if (fields.length === 0) return;
    values.push(id);
    await this.db.query(
      `UPDATE style_rules SET ${fields.join(", ")} WHERE id = $${values.length}`,
      values,
    );
  }

  // Synthesize the style guide from approved rules.
  // We feed the model the current guide + top approved rules and ask for
  // a concise rewrite. Approved rules are authoritative; unapproved ones
  // are advisory hints the model may or may not incorporate.
  async synthesize(): Promise<string> {
    const { rows: approved } = await this.db.query<{
      pattern: string;
      replacement: string;
      rationale: string | null;
    }>(
      `SELECT pattern, replacement, rationale
         FROM style_rules
        WHERE approved = true AND disabled = false
        ORDER BY frequency DESC
        LIMIT 50`,
    );
    if (approved.length === 0) return await this.get();

    const current = await this.get();
    const rulesText = approved
      .map(
        (r, i) =>
          `${i + 1}. "${r.pattern}" → "${r.replacement}"${r.rationale ? ` (${r.rationale})` : ""}`,
      )
      .join("\n");

    const out = await this.llm.complete({
      system:
        "You maintain a concise style guide for legal-document drafts. " +
        "Given the current guide and a list of approved (pattern → replacement) rules, " +
        "produce an updated guide. Rules:\n" +
        "- Output ONLY the new style guide content (no commentary, no JSON).\n" +
        "- Keep it under 30 short bullet points.\n" +
        "- Group related guidance.\n" +
        "- Phrase each bullet as imperative guidance the drafter can follow.",
      messages: [
        {
          role: "user",
          content:
            `CURRENT STYLE GUIDE:\n${current || "(empty)"}\n\n` +
            `APPROVED RULES:\n${rulesText}\n\n` +
            `Produce the updated style guide.`,
        },
      ],
      maxTokens: 1200,
      temperature: 0.2,
    });

    await this.db.query(
      `UPDATE style_guide SET content = $1, updated_at = now() WHERE id = 1`,
      [out.trim()],
    );
    this.log.log(`style guide synthesized (${out.length} chars, ${approved.length} approved rules)`);
    return out.trim();
  }
}
