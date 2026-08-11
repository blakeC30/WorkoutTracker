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

## The dashboard

Four screens — **Today**, **History**, **Exercises**, **Food** — built for one device: an iPhone 13
Pro added to the home screen. There are no width breakpoints anywhere in `web/`, on purpose.

One question per tab: *now / over time / exercises / food*. There used to be a fifth, Week, whose
eight-week ledger answered the same question as the month grid at a different zoom; it now sits
below that grid on History instead.

**Today** opens with how long since each movement pattern was last trained, because that is the
only thing on the screen that says what to *do*. Volume below it is grouped by pattern, and
patterns with no tonnage — cardio, planks — are reported in minutes and miles rather than
dropped, since a bar chart silently omitting core reads as "you have not trained it".

**Exercises** is the `exercises` catalog with a record and a trend on each — the counterpart to
the Food tab, which browses the other catalog. It splits into Loaded, Bodyweight and Cardio by
*kind* of exercise rather than by unit of measurement, so a plank sits with the calisthenics
instead of beside the rowing machine.

Each row draws a sparkline of its own last ten sessions, never scaled against other exercises:
a bar comparing a curl to a leg press only restates which movements use big muscles. Tapping
one opens its full history — estimated 1RM per session, the sets of each, volume per session.
Nothing else in the app can distinguish a lift that added 40lb last month from one stalled
since June.

**History** is the calendar, and it encodes **kind and presence rather than magnitude** — how
much you lifted is answered better on Today and Food, while what only a calendar can answer is
what kind of day this was and when you last did it. Each square carries two fixed-order rows of
slots: movement patterns on top (push · pull · legs · core · cardio) and the three anchor meals
below. Position is the encoding, so the palette stays one colour and a leg day has a different
silhouette from a pull day.

Below the grid, a **coverage matrix** puts every pattern against every day of the month — the
answer to "what am I neglecting" — and a **last-trained strip** shows days since each pattern,
most overdue first. That strip has its own endpoint on purpose: if you last trained pull in
June and you're looking at August, the month's rows contain no evidence pull exists.

Tapping a square opens `/calendar/<date>` with the complete record of that day — every set of
every exercise, every dish with its portion, and the raw journal text it was parsed from. It is
the only screen that shows individual sets or journal text; everywhere else is a rollup.

`exercises.pattern` is what all of that groups by, and it deliberately lives on the exercise
rather than on the muscle: **the pattern is a property of the movement**.

Five patterns own a colour and a calendar slot; anything else — sports, mobility — falls into
`other`, shown as "Sport & other" in neutral ink. It appears as a ROW wherever there is one
(Today's volume, last-trained, the coverage matrix) but gets no square slot, since the squares
are legible at 6px only because five positions never change. `PATTERNS` and `PATTERN_ROWS` in
`web/src/lib/patterns.ts` are that distinction. A bench press is a
push even though triceps do real work; a curl is a pull even though it is the same arm.
Deriving it from muscles puts both in "arms" and gets both wrong.

Two notes on that screen, both consequences of schema rules:

- **Journals are found by what they produced**, never by their own `created_at`. "Yesterday I
  squatted" writes a workout dated yesterday from a journal stamped today, so the day page
  labels an entry `written 11 Aug` when the two dates disagree.
- **Food macros are per unit**, and `servings` multiplies them. A 6 oz chicken breast is stored
  as `calories: 47, servings: 6`. Rendering `calories` alone under-reports a day by the portion
  size.

`npm run dev` in `web/` serves it on :3001. It needs the backend running on :3000, since every
screen fetches from the REST API.

How the secret stays server-side: each screen is a Server Component that calls
`src/lib/backend.ts`, which begins with `import 'server-only'` — importing it from a Client
Component is a **build error**, not a code-review catch. Data reaches the two interactive
components as plain props. Verify with `grep -r "$API_SECRET" web/.next/static` after a
build; it should return nothing.

### The one write

The dashboard is otherwise read-only, but the review queue can correct a food's macros in
place — the capability the schema was built for (`journal_id` is nullable *because* rows
corrected by hand in the dashboard have no journal origin).

It goes through a Server Action, not a route handler: the action runs on the server so it can
reach the module holding the secret, and `web/` never grows a public POST endpoint of its own.
The backend side is `POST /api/foods`, wrapped in `writeEndpoint` rather than `readEndpoint` —
kept as a separate wrapper on purpose, since a read that leaks is a disclosure but a write that
gets through is corruption of the log.

An empty field means "leave this alone", not zero. Saving marks the food `high` confidence and
moves **every meal ever logged with it**, including past days — the UI says so above the button.

Before changing anything visual, read **`web/DESIGN.md`**. It fixes the palette, the two
typefaces, the spacing scale, and a list of things this codebase deliberately does not do
(no cards, no gradients, no shadows, no border radius above 2px, no dark-mode toggle). It
exists so the design stays a decision rather than drifting back to defaults.

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
