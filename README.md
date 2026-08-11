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

## Changing an MCP tool schema — reconnect the connector

**MCP clients fetch tool definitions once, when the connection is established.** Deploying a
change to a tool's input schema does not reach a connector that is already connected — it
keeps using the definitions it fetched originally, however many times you redeploy.

The failure is quiet and easy to misread. Claude doesn't error; it works around the field it
can't see. When `meal_type` was added, an already-connected client kept writing "Breakfast:"
into the description text instead, and every `meal_type` came back null — which looks exactly
like a prompt that isn't landing.

After any change to a tool's `inputSchema`, **remove the connector and add it again**.
Toggling it off and on is not enough — that has been observed to keep the cached tool list.
A connector left connected across several schema changes was still serving the original
six-field meal schema weeks later.

A partial symptom is the confusing one: fields named in the project instructions still get
populated, because the model sends them as plain strings even when its cached schema omits
them, and the server accepts them. Nested objects (like `recipe`) never appear, because
inventing a whole object that isn't in the schema is a much bigger leap. So you can see
`meal_type` filling in correctly while `recipe` is silently ignored — which looks like a
prompt problem and isn't.

To check what the model actually sees, ask it directly in the conversation: *"List every
field the log_entry tool accepts inside a meals entry."* Compare that to `tools/list` below. To confirm what a deployment is actually serving:

```bash
SECRET=$(grep '^API_SECRET=' backend/.env.local | cut -d= -f2-)
curl -s -X POST "https://<your-backend>.vercel.app/api/mcp/$SECRET" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

If the field is in that response but missing from what Claude sends, it's the cache — not the
prompt, and not the code.

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
