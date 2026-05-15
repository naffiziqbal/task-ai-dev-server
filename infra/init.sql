-- pgvector + initial schema for the legal workflow.
-- Idempotent: safe to re-run.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  username       TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS cases (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                 UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  filename                TEXT NOT NULL,
  mime                    TEXT,
  blob_key                TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'pending',
  page_count              INTEGER,
  pages_done              INTEGER,
  pages_total             INTEGER,
  mean_ocr_confidence     REAL,
  document_type           TEXT,
  error                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_documents_case ON documents(case_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);

CREATE TABLE IF NOT EXISTS pages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_number     INTEGER NOT NULL,
  text            TEXT,
  ocr_confidence  REAL,
  image_key       TEXT,
  UNIQUE (document_id, page_number)
);
CREATE INDEX IF NOT EXISTS idx_pages_document ON pages(document_id);

CREATE TABLE IF NOT EXISTS chunks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_id     UUID REFERENCES pages(id) ON DELETE SET NULL,
  page_number INTEGER NOT NULL,
  text        TEXT NOT NULL,
  char_start  INTEGER NOT NULL,
  char_end    INTEGER NOT NULL,
  embedding   vector(768),
  tsv         tsvector,
  trust_score REAL NOT NULL DEFAULT 1.0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_tsv ON chunks USING gin(tsv);
-- IVFFlat needs data + ANALYZE to be useful; skip until populated.

CREATE TABLE IF NOT EXISTS extractions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  schema_version  TEXT NOT NULL,
  payload         JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS drafts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id       UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL DEFAULT 1,
  sections      JSONB NOT NULL,
  citations     JSONB NOT NULL,
  edited        BOOLEAN NOT NULL DEFAULT false,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_drafts_case ON drafts(case_id);

CREATE TABLE IF NOT EXISTS edit_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id           UUID NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  section            TEXT NOT NULL,
  sentence_before    TEXT,
  sentence_after     TEXT,
  edit_type          TEXT,
  supporting_chunks  JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_edit_events_draft ON edit_events(draft_id);
CREATE INDEX IF NOT EXISTS idx_edit_events_type ON edit_events(edit_type);

CREATE TABLE IF NOT EXISTS style_rules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern      TEXT NOT NULL,
  replacement  TEXT NOT NULL,
  rationale    TEXT,
  frequency    INTEGER NOT NULL DEFAULT 1,
  approved     BOOLEAN NOT NULL DEFAULT false,
  disabled     BOOLEAN NOT NULL DEFAULT false,
  last_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS retrieval_misses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  missed_chunk_id UUID REFERENCES chunks(id) ON DELETE SET NULL,
  added_sentence  TEXT NOT NULL,
  query_sub_topic TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edit_pairs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id       UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  draft_id      UUID NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  section       TEXT NOT NULL,
  default_text  TEXT NOT NULL,
  edited_text   TEXT NOT NULL,
  embedding     vector(768),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_edit_pairs_section ON edit_pairs(section);

CREATE TABLE IF NOT EXISTS style_guide (
  id          INTEGER PRIMARY KEY DEFAULT 1,
  content     TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT singleton CHECK (id = 1)
);
INSERT INTO style_guide (id, content) VALUES (1, '') ON CONFLICT DO NOTHING;
