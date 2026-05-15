# backend — PSL Litigation API

NestJS 10 backend for the PSL litigation workflow. Handles document ingest
(OCR + extraction + chunking + embedding), hybrid retrieval, grounded draft
generation, and the edit-learning loop.

This is a standalone codebase. It does not share modules with the client —
the few TypeScript types the client also cares about (e.g. `DraftSection`,
`Citation`) are duplicated there.

## Quick start

```bash
cp .env.example .env             # add OPENAI_API_KEY
docker compose up -d             # postgres + redis + minio
pnpm install
pnpm dev                         # nest start --watch, listens on :4000
```

To run the backend and client inside docker as well:

```bash
docker compose up -d --build
```

Everything comes up as separate containers under the `task` project:
`task-postgres`, `task-redis`, `task-minio`, `task-backend`, `task-client`.

## Scripts

| script        | what it does                                         |
| ------------- | ---------------------------------------------------- |
| `pnpm dev`    | watch mode (`nest start --watch`)                    |
| `pnpm build`  | `nest build` → `dist/`                               |
| `pnpm start`  | `node dist/main.js`                                  |
| `pnpm worker` | standalone BullMQ worker (`node dist/worker.js`)     |

## Layout

```
src/
├── ingest/        upload → OCR → extract → chunk
├── retrieve/      hybrid vector + BM25 + RRF
├── draft/         section-wise grounded generation
├── learning/      edit-capture, classifier, style guide, few-shot
├── style-rules/   admin review of learned rules
├── llm/           OpenAI generation + embedding clients
├── db/  storage/  queue/
├── schemas.ts     zod schemas (extraction, edit classification)
├── sections.ts    Case Fact Summary structure + per-section sub-queries
├── types.ts       Citation, DraftSection, RetrievedPassage, …
└── main.ts  worker.ts

infra/init.sql     pgvector + initial schema
fixtures/          3 messy seed documents
docker-compose.yml postgres + pgvector + redis + minio (+ optional app profile)
```
