# WorkoutTracker

Personal fitness tracking. Log workouts by talking to Claude on a phone; review them on a
web dashboard.

## Layout

Two independent Next.js apps in one repo. **No monorepo tooling** — each folder has its own
`package.json` and its own `node_modules`, and each deploys as a separate Vercel project
using Vercel's Root Directory setting.

| Folder     | Vercel Root Directory | What it is                                             |
| ---------- | --------------------- | ------------------------------------------------------ |
| `backend/` | `backend`             | MCP server and REST read API. Owns Postgres.           |
| `web/`     | `web`                 | Dashboard. Talks to the backend, never to Postgres.    |

Duplicating a few type definitions between the two is expected and fine.

## Rules

- The Neon connection string and the API secret live **only** in `backend/`.
- Never in `web/` client code, never in a `NEXT_PUBLIC_` variable, never committed.
- When `web/` needs data, its own server-side route fetches from the backend and holds the
  secret. The browser never sees it.

## Local setup

```bash
cd backend && npm install
cp .env.example .env.local              # fill in with the Neon DEV BRANCH, APP_ENV=development
cp .env.example .env.production.local   # fill in with production, APP_ENV=production
npm run db:target                       # confirm .env.local is pointed at the dev branch
npm run migrate                         # applies to the dev branch

cd ../web && npm install && cp .env.example .env.local
```

See [Environments](#environments) for why there are two files and which commands read which.

## Backend commands

| Command                | Database        | What it does                                |
| ---------------------- | --------------- | ------------------------------------------- |
| `npm run dev`          | dev branch      | Local dev server on :3000                   |
| `npm run db:target`    | dev branch      | Prints which database this env file points at, and connects to prove it. |
| `npm run migrate`      | dev branch      | Applies any unapplied `.sql` in `migrations/`. Safe to re-run. |
| `npm run seed`         | dev branch      | Eight weeks of invented history, every row `is_seed`. |
| `npm run seed:clear`   | dev branch      | Deletes `is_seed` rows only.                |
| `npm run migrate:prod` | **production**  | The same migrations, against production. Asks for the database name first. |
| `npm run db:target:prod` | **production** | Read-only. Confirms what the production env file points at. |

`/api/health` answers twice. Anonymous callers get `{ "ok": true }` — a real liveness probe
that round-trips to Neon and discloses nothing, safe for an uptime monitor. With the secret it
returns the full diagnostic, including migration drift:

```bash
curl -H "Authorization: Bearer $API_SECRET" https://<backend>.vercel.app/api/health
```

Deploy order is migrate, then push, then check that — migrating first makes the brief
disagreement `ahead` (harmless) rather than `pending` (a 503).

## Environments

Since **11 August 2026** the Neon `main` branch is production: it holds real logged training,
and the dashboard is deployed on Vercel against it. There is no undo. Journals are the record
of what was said, and once a row is gone the only copy is a Neon branch or a backup.

Development happens on a **Neon dev branch** — copy-on-write, so it starts as a real-shaped
copy of production and costs almost nothing. That is the part that matters: on a branch,
destructive is free. Wipe it, seed it, truncate it, then reset it from its parent in seconds.

Two env files decide where a command lands, and **which one is the default is the whole
design**:

| File | Points at | Loaded by |
| ---- | --------- | --------- |
| `backend/.env.local` | Neon dev branch | everything except the two below |
| `backend/.env.production.local` | production | `migrate:prod`, `db:target:prod` |

This repo started with production in `.env.local`, so every local command reached production
and safety was a memory task. Now forgetting fails safe: the unnamed default is dev, and
production has to be asked for.

`APP_ENV` in each file drives the guards in [`backend/scripts/lib/env.mjs`](backend/scripts/lib/env.mjs):

- **`seed`, `seed:clear`** refuse outright against production.
- **`migrate`** asks — migrations are the one destructive thing that legitimately has to reach
  production, and also the least reversible. A y/n prompt is muscle memory, so it wants the
  database name typed.
- **Unset counts as production.** The unknown case is the dangerous one.
- **`APP_ENV` is cross-checked**, because it is a label a human maintains. If it says
  development while the connection points at the same host as `.env.production.local`, every
  guarded script refuses. That single mistake — pasting the prod string in and leaving the
  label alone — would otherwise defeat all of the above without a symptom.

What none of this reaches: **anything logged through Claude**. The guards above live in the
npm scripts, and the MCP connector does not go near them — it talks to the deployed backend,
which is pointed at production. So a message sent to the connector writes to production no
matter what `backend/.env.local` says. Exercising the logging flow against the dev branch
would take a second deployment and a second connector; the env split protects the scripts,
not the conversation.

## Dashboard login

One password, one cookie, no user table — there is exactly one reader, so a session is only
ever the claim *"whoever holds this cookie typed the password once"*.

```bash
cd web && npm run auth:setup          # invents a password, prints the two values to set
```

Put `SESSION_SECRET` and `AUTH_PASSWORD_HASH` in `web/.env.local` **and** in the web project's
Vercel environment variables. Without them every request throws — a missing secret must never
degrade to an unlocked door.

**Two layers, and only one of them is the boundary.**
[`web/src/proxy.ts`](web/src/proxy.ts) redirects anyone without a session to `/login`. That is
an *optimistic* check in Next's own terms: a matcher is a path regex, and the failure mode of
a regex is a path nobody thought of. The enforcing check is in
[`web/src/lib/backend.ts`](web/src/lib/backend.ts), the single module that can reach the
backend at all — a route the matcher misses still fetches nothing. `proxy.ts` buys the
difference between a locked door and a wall: a login form instead of a broken page.

It is `proxy.ts`, not `middleware.ts` — the middleware convention is deprecated in Next 16.

**Staying signed in on the iPhone home screen.** The cookie is `HttpOnly`, `Secure`,
`SameSite=Lax`, and set by the server, with a 400-day max age (the ceiling browsers allow).
That combination is load-bearing, not decoration:

- Safari's ITP expires *script-writable* storage after seven idle days — `localStorage`,
  IndexedDB, and anything written via `document.cookie`. A token kept in any of those would
  sign you out roughly weekly. Cookies set in a `Set-Cookie` response header are exempt.
- **Sign in once from the home-screen app itself.** iOS gives a standalone web app its own
  storage container, so a session established in Safari does not necessarily carry over.
- The login form carries a hidden `username` field. There is only one user, but iCloud
  Keychain offers to save a password far more reliably when it has something to file it
  under — which is what makes Face ID autofill work on the rare occasions you do sign in.
- `/icon`, `/apple-icon` and `/manifest.webmanifest` are deliberately outside the matcher. iOS
  fetches all three while installing to the home screen, before any session exists.

**Revoking a device** means changing `SESSION_SECRET` — every outstanding cookie fails its
signature check at once. There is no session list to revoke from, by design.

**Turning it off locally.** `AUTH_DISABLED=true` in `web/.env.local` skips the login, and with
it set you do not need `SESSION_SECRET` or `AUTH_PASSWORD_HASH` at all — a fresh clone runs
`npm run dev` without generating anything.

It takes two independent things to be true, and only one of them is a variable anyone can set:
`NODE_ENV` must not be `production` **and** the flag must be explicitly `true` or `1`. The
first is the one doing the work — Next hardcodes production into `next build` output, so it
describes how the code was compiled rather than what a label claims. Setting `AUTH_DISABLED`
on Vercel does nothing except print a line in the logs saying it was ignored. A local
`npm run start` is a production build too, so it keeps asking for the password; that is the
point of running it.

**Failed logins are capped** at 8 per address per 10 minutes
([`web/src/lib/rate-limit.ts`](web/src/lib/rate-limit.ts)), checked *before* the password is
hashed. The point is not guess-prevention — a generated password will not fall to guessing at
any rate this permits — it is that scrypt is deliberately expensive, and an unlimited number
of anonymous requests each costing real function time is worth refusing cheaply. It also
covers the `auth:setup -- "my own phrase"` escape hatch, where the password is whatever
someone chose by hand.

The counter is per-instance memory, so an attacker spread across Vercel instances gets a
fresh allowance from each, and a deploy clears it. Making that airtight needs shared state
(KV, Upstash, a table reached through the backend) — a service to configure and pay for, to
harden a door whose key is already 139 bits. Buckets are keyed per address precisely so that
someone else's failures can never lock *you* out.

**Still uncovered:** the MCP endpoint carries its secret in the URL path rather than a header
— deliberate, since Claude's header auth is a gated beta, and documented under
[MCP tools](#mcp-tools).

## The dashboard

Four screens — **Today**, **History**, **Exercises**, **Food** — built for one device: an iPhone 13
Pro added to the home screen. There are no width breakpoints anywhere in `web/`, on purpose.

One question per tab: *now / over time / exercises / food*. There used to be a fifth, Week, whose
eight-week ledger answered the same question as the month grid at a different zoom; it now sits
below that grid on History instead.

### The launch screen

Cold-launching from the home screen used to show **white** until the first paint. The manifest's
`background_color` does not prevent that — it is what Chrome on Android builds a splash from, and
iOS has never read it. iOS wants `apple-touch-startup-image`, one per device geometry, and matches
on **exact pixel dimensions**: a near miss is silently ignored and you are back to white.

[`web/src/lib/splash.ts`](web/src/lib/splash.ts) holds the device list and derives both the media
queries and the pixel sizes, so the two cannot disagree.
[`/apple-splash/[size]`](web/src/app/apple-splash/) renders the icon's mark on `#121110` at the
requested size, generated the same way as `icon.tsx` rather than committed as thirteen PNGs. Only
advertised sizes render; anything else is a 404, since an arbitrary `WxH` from a URL is an
invitation to ask for 30000x30000. The route sits outside the proxy matcher because iOS fetches
launch images at install time with no session.

The links alone were not enough. Next 16 renders `appleWebApp.capable: true` as the **standard**
`mobile-web-app-capable` and no longer emits Apple's legacy `apple-mobile-web-app-capable`.
Standalone launch still worked — iOS 16.4+ takes that from the manifest's `display` — but
`apple-touch-startup-image` predates the manifest and still gates on the legacy meta, so iOS
ignored all thirteen images and painted white. That is indistinguishable from the images being
wrong, which is why the tags were never the suspect. The layout adds the legacy name back via
`metadata.other`; both are emitted, and they are two generations of the same declaration
rather than a duplicate.

> **After deploying this, delete the home-screen icon and add it again.** iOS caches launch
> images when the app is installed and does not go looking for new ones. Without a re-add you
> will keep seeing the white screen and conclude, reasonably but wrongly, that it did not work.

**Today** opens with how long since each movement pattern was last trained, because that is the
only thing on the screen that says what to *do*. Below it, **Coverage** takes the same question
one level finer: every muscle in the catalog, grouped by region, with a mark each — filled where
a movement was *for* that muscle, hollow where it only assisted, and a hairline track where it
was not touched at all. A region nothing has ever reached reads `never` rather than `0/6`, since
a lapse and a movement you have never programmed are different problems.

The primary/secondary split is the reading it exists for. Presses and rows drive the triceps,
biceps and front delts hard without a single movement ever being *for* them, so those regions
come back **worked, never targeted** — a real gap that a volume total actively hides, because by
tonnage they look busy. Nothing else in the app can say it: a pattern says a pull happened, and
only this says the lats got it while the traps and rear delts did not.

It is built on *performance*, never tonnage. `getVolumeByMuscle` — which the `get_volume_by_muscle`
MCP tool serves — filters to loaded sets, so sit-ups attribute nothing to abs, pull-ups nothing
to lats, and a three-mile run nothing to cardiovascular; whole regions vanish from its output
despite being trained. `getMuscleCoverage` counts a muscle as worked when the movement was
performed, which every kind of training produces. The two disagree on purpose.

Coverage replaced a four-week volume-by-pattern chart, and that removal is worth recording.
Volume reported a magnitude with nothing to compare it against — no target exists in the schema
and it queried a single window — so its only available comparison was *between* patterns, and
tonnage between patterns mostly encodes which muscles are big. A leg press will always dwarf a
lateral raise. That argument had already been made once here, when the bars on the exercises
list became sparklines, and it applies just as well one level up. It also asked a four-week
question on a screen otherwise about *now*, and answered "what am I neglecting" a third time
after the pattern strip above it and the coverage matrix on History.

Regions are drawn in ink, never in the pattern palette. They are a second taxonomy sitting one
section below the first, and colouring them is the fastest way to make the pattern colours stop
meaning anything — so what varies is how lit a mark is, not what colour it is. The order in
`web/src/lib/muscles.ts` runs roughly top of the body down rather than alphabetically, because
alphabetical buries legs in the middle and legs is the row most likely to be the problem.

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
what kind of day this was and when you last did it. Each square carries three fixed-order rows,
read in the order a day is built: whether you **weighed in**, then movement patterns
(push · pull · legs · core · cardio), then the three anchor meals. Position is the encoding, so
the palette stays one colour and a leg day has a different silhouette from a pull day.

The weigh-in row is one bar spanning the whole square rather than a strip of slots, because there
is only ever one weigh-in and nothing for it to hold a position against. An unweighed day keeps
the empty track, so the two rows below never shift up and one square's silhouette stays
comparable with another's. The number itself is never shown: a weight in a 48px box is a
magnitude with nothing beside it to compare against, and the day page and Today's chart both
already answer that. It also means a day with *only* a weigh-in is no longer a lit, tappable
square with nothing on it.

The legend below the grid is a closed `<details>` — a native disclosure, so it holds no state and
ships no JavaScript. The grid is read every day and the legend about twice, so it earns a line
rather than a permanent block above the fold.

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

## MCP tools

Fifteen, defined in `backend/src/lib/mcp.ts` with their inputs in `backend/src/lib/schemas.ts`.

| Tool                    | Kind    | For                                                          |
| ----------------------- | ------- | ------------------------------------------------------------ |
| `log_entry`             | write   | One message of training, food, and/or bodyweight, as one journal entry |
| `delete_entries`        | write   | Delete logged rows, by journal or individually. Preview first |
| `save_food`             | write   | Create or correct a food. Fixes every meal ever logged with it |
| `save_exercise`         | write   | Create or correct an exercise. **The only way to rename one** |
| `search_foods`          | read    | Fuzzy food lookup — call before logging a meal                |
| `search_exercises`      | read    | Fuzzy exercise lookup — call before logging a workout         |
| `list_muscles`          | read    | The valid muscle names. Anything else is rejected             |
| `get_recent_history`    | read    | Last N days of workouts, bodyweight and meals                 |
| `get_journal`           | read    | Raw journal text in a date range — provenance, not numbers    |
| `get_prs`               | read    | Best effort per exercise, typed by how it's measured          |
| `get_exercise_history`  | read    | One movement session by session — the trend, not the record   |
| `get_pattern_volume`    | read    | Push / pull / legs / core / cardio balance over a window      |
| `get_pattern_recency`   | read    | Days since each pattern was last trained — what's overdue     |
| `get_weekly_summary`    | read    | Training, nutrition and bodyweight per week                   |
| `get_volume_by_muscle`  | read    | Volume by muscle region                                       |

Keep this table current. The failure it prevents has already happened once: the server's
`instructions` told the model to call `list_recipes` for months after migration 004 renamed
`recipes` to `foods` and the tool was removed — a rule pointing at nothing, sitting in the
highest-priority text the model reads.

### Where a rule belongs

Two layers of instruction reach the model and they do different jobs.

- **`instructions` in `backend/src/lib/mcp.ts`** ships with the connector, so it applies in
  every conversation on every surface. **Every rule protecting data integrity lives here** —
  dates, catalog-before-create, one row per dish, Title Case, movement pattern, one entry per
  set, never estimate RPE, confirm before deleting.
- **`prompts/project-instructions.md`** is pasted into one Claude project and applies only
  there. It holds judgment and tone: how hard to hunt for a real recipe, where the edge of "one
  dish" falls, what to say back after saving.

The test when adding a rule: if breaking it would corrupt data, it goes in the server. If
breaking it would only make the assistant worse to talk to, it goes in the project file. Never
state a rule in both — a duplicated rule eventually disagrees with itself, and the project copy
is the one that isn't running everywhere.

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
them, and the server accepts them. Nested objects (like `exercise` inside a workout) never
appear, because inventing a whole object that isn't in the schema is a much bigger leap. So you
can see `meal_type` filling in correctly while a nested object is silently ignored — which
looks like a prompt problem and isn't.

The quickest check is the version. `serverInfo.version` in `backend/src/lib/mcp.ts` is bumped
on every tool or schema change, so asking the model what version the workout-tracker server
reports and comparing it to that constant answers "is this connector stale" in one question.

To see the schema itself, ask directly: *"List every field the log_entry tool accepts inside a
meals entry."* Compare that to `tools/list`. To confirm what a deployment is actually serving:

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

Nine tables in three layers.

| Layer       | Tables                                      | Holds                                        |
| ----------- | ------------------------------------------- | -------------------------------------------- |
| Provenance  | `journals`                                  | The raw text of everything typed              |
| Logs        | `workouts`, `workout_sets`, `meals`, `bodyweight` | What happened on a date                 |
| Catalogs    | `foods`, `exercises`, `exercise_muscles`, `muscles` | Facts true every time                  |

The layer split is the design. A log row carries no macros and no muscle groups of its own —
it points at a catalog row — so correcting a catalog entry corrects every entry ever logged
with it, retroactively and everywhere. That is why both catalogs are searched before anything
is created, and why `foods` and `exercises` each have a unique index on `lower(name)`
(migration 007): two spellings of one thing silently halve its history.

- A journal's `created_at` is **not** the data's `entry_date`. "Yesterday I squatted" is a
  journal row stamped today and a workout row dated yesterday. Never derive one from the other.
- `journal_id` is nullable — rows created or corrected by hand in the dashboard have no
  journal origin. Don't invent placeholder journals for them.
- **Journals are never deleted by any tool.** A journal records what was *said*, and it was
  said; what can be wrong is how it was interpreted, and that is the rows. `delete_entries`
  removes rows — a whole message's output, or single rows by id — and always leaves the text.
  The `on delete cascade` on `journal_id` stays anyway: it costs nothing, `seed:clear` deletes
  through it, and a policy in one function is easier to change than a dropped constraint is to
  restore.
- A journal whose rows are all deleted keeps its text but stops appearing in the dashboard,
  because a day is assembled from the rows recorded against it. `delete_entries` says so in
  the preview rather than letting it be a surprise.
- The journal is provenance, not state. If a value is corrected in the dashboard, the stored
  number wins and the journal text is left alone.
