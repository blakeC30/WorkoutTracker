/**
 * The timezone this log is kept in.
 *
 * `created_at` is a timestamptz, which Postgres stores in UTC. Reading it back without
 * converting means an entry logged at 7:56pm Central comes back as 00:56 the *next day* —
 * so every evening entry gets filed under tomorrow. That silently broke get_journal, which
 * filters on when an entry was written: "what did I log tonight" found nothing.
 *
 * Storing UTC is correct and stays that way. What has to be pinned is the zone we convert
 * to when deciding which calendar day a timestamp belongs to. This app has exactly one
 * user in one place, so a single constant is the whole solution — no per-user zone, no
 * offset math at the call site.
 *
 * If you move, change this line. Existing rows keep their real instants; only the day
 * boundaries shift.
 */
export const APP_TIMEZONE = 'America/Chicago';
