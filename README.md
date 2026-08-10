# WorkoutTracker

Personal fitness tracking. Log workouts by talking to Claude on a phone; review them on a
web dashboard.

## Layout

Two independent Next.js apps in one repo. **No monorepo tooling** — each folder has its own
`package.json` and its own `node_modules`, and each deploys as a separate Vercel project
using Vercel's Root Directory setting.

| Folder     | Vercel Root Directory | What it is                                             |
| ---------- | --------------------- | ------------------------------------------------------ |
| `backend/` | `backend`             | MCP server, REST read API, LangGraph agent. Owns Postgres. |
| `web/`     | `web`                 | Dashboard. Talks to the backend, never to Postgres.    |

Duplicating a few type definitions between the two is expected and fine.

## Rules

- The Neon connection string and the API secret live **only** in `backend/`.
- Never in `web/` client code, never in a `NEXT_PUBLIC_` variable, never committed.
- When `web/` needs data, its own server-side route fetches from the backend and holds the
  secret. The browser never sees it.

## Local setup

```bash
cd backend && npm install && cp .env.example .env.local   # then fill in .env.local
npm run migrate

cd ../web && npm install && cp .env.example .env.local
```

## Backend commands

| Command           | What it does                                              |
| ----------------- | --------------------------------------------------------- |
| `npm run dev`     | Local dev server on :3000                                  |
| `npm run migrate` | Applies any unapplied `.sql` file in `migrations/`. Safe to re-run. |

## Database

Neon Postgres 18, region `aws-us-east-1` (matches Vercel's default `iad1` function region).

Four tables. `journals` holds the raw text of everything typed; `workouts`, `bodyweight`
and `meals` hold the structured data parsed out of it and link back to their origin.

- A journal's `created_at` is **not** the data's `entry_date`. "Yesterday I squatted" is a
  journal row stamped today and a workout row dated yesterday. Never derive one from the other.
- `journal_id` is nullable — rows created or corrected by hand in the dashboard have no
  journal origin. Don't invent placeholder journals for them.
- Deleting a journal cascades to everything parsed from it. That's what powers undo.
- The journal is provenance, not state. If a value is corrected in the dashboard, the stored
  number wins and the journal text is left alone.
