import {
  ConflictException,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from "@nestjs/common";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { DbService } from "../db/db.service";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface UserRow {
  id: string;
  email: string;
  name: string;
  username: string;
  created_at: string;
}

export type PublicUser = Pick<
  UserRow,
  "id" | "email" | "name" | "username" | "created_at"
>;

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(private readonly db: DbService) {}

  async onModuleInit() {
    // Auto-apply auth schema. Idempotent. init.sql only runs on a fresh
    // volume, so this covers existing dev DBs where the volume already
    // exists from before auth was added.
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email          TEXT NOT NULL UNIQUE,
        name           TEXT NOT NULL,
        username       TEXT NOT NULL UNIQUE,
        password_hash  TEXT NOT NULL,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        token       TEXT PRIMARY KEY,
        user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at  TIMESTAMPTZ NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await this.db.query(
      `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);`,
    );
  }

  async signUp(input: {
    email: string;
    password: string;
    name: string;
  }): Promise<{ user: PublicUser; token: string; expiresAt: Date }> {
    const email = input.email.trim().toLowerCase();
    const name = input.name.trim();

    const existing = await this.db.query<{ id: string }>(
      "SELECT id FROM users WHERE email = $1",
      [email],
    );
    if (existing.rows.length > 0) {
      throw new ConflictException("email already registered");
    }

    const passwordHash = await hashPassword(input.password);
    const username = await this.generateUniqueUsername(name);

    const { rows } = await this.db.query<UserRow>(
      `INSERT INTO users (email, name, username, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, name, username, created_at`,
      [email, name, username, passwordHash],
    );

    const session = await this.createSession(rows[0].id);
    return { user: rows[0], ...session };
  }

  async signIn(
    email: string,
    password: string,
  ): Promise<{ user: PublicUser; token: string; expiresAt: Date }> {
    const { rows } = await this.db.query<UserRow & { password_hash: string }>(
      `SELECT id, email, name, username, created_at, password_hash
         FROM users WHERE email = $1`,
      [email.trim().toLowerCase()],
    );
    const row = rows[0];
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      throw new UnauthorizedException("invalid email or password");
    }
    const { password_hash, ...user } = row;
    const session = await this.createSession(user.id);
    return { user, ...session };
  }

  async signOut(token: string): Promise<void> {
    await this.db.query("DELETE FROM sessions WHERE token = $1", [token]);
  }

  async getUserByToken(token: string): Promise<PublicUser | null> {
    const { rows } = await this.db.query<UserRow>(
      `SELECT u.id, u.email, u.name, u.username, u.created_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token = $1 AND s.expires_at > now()`,
      [token],
    );
    return rows[0] ?? null;
  }

  private async createSession(userId: string) {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.db.query(
      "INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)",
      [token, userId, expiresAt],
    );
    return { token, expiresAt };
  }

  private async generateUniqueUsername(name: string): Promise<string> {
    const base = slugify(name);
    for (let i = 0; i < 8; i++) {
      const suffix = randomBytes(3).toString("hex"); // 6 hex chars
      const candidate = `${base}-${suffix}`;
      const { rows } = await this.db.query<{ id: string }>(
        "SELECT id FROM users WHERE username = $1",
        [candidate],
      );
      if (rows.length === 0) return candidate;
    }
    throw new Error("could not allocate a unique username");
  }
}

function slugify(name: string): string {
  const cleaned = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 16);
  return cleaned || "user";
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const parts = hash.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const actual = await scrypt(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
