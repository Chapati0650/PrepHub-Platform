# PrepHub

Adaptive SAT preparation platform. See `docs/` for the full PRD set (000–017) and
the Global Engineering Requirements. See `CLAUDE.md` for the engineering conventions
distilled from those documents.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in real values; DATABASE_URL already matches db:local below

npm run db:local             # starts a real local Postgres on :5433 (Ctrl+C to stop)
npm run db:migrate           # in another terminal: apply migrations
npx prisma db seed           # sample schools/districts for the district-verification flow
npm run dev                  # http://localhost:3000
```

`db:local` runs a genuine native Postgres via the `embedded-postgres` package (no
Docker/root needed) — data lives in `.pgdata/` (gitignored), which is deleted to
reset. Deliberately **not** using `npx prisma dev`'s bundled local database: its
connection proxy corrupts prepared-statement state when a `$transaction()` call
overlaps with other concurrent queries (Postgres error `08P01`), which is a real
issue with that proxy specifically, not with our code or with real Postgres —
confirmed via an isolated repro. Real environments use a hosted Postgres
(Neon/Supabase, see CLAUDE.md) with proper backups/PITR, which doesn't have this
proxy layer either.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` / `start` | Production build / serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run test` / `test:watch` | Vitest unit tests |
| `npm run e2e` | Playwright end-to-end tests |
| `npm run db:local` | Start the local dev Postgres (foreground; Ctrl+C to stop) |
| `npm run db:generate` | Regenerate the Prisma client after a schema change |
| `npm run db:migrate` | Create + apply a migration (needs a real `DATABASE_URL`) |
| `npm run db:push` | Push schema without a migration (prototyping only) |
| `npm run db:studio` | Prisma Studio |

## Stack

Next.js (App Router, TS) · PostgreSQL + Prisma 7 (driver adapters) · Auth.js
(Google + Credentials) · Stripe · Tailwind + shadcn/ui · Vitest + Playwright.
See `CLAUDE.md` for why.
