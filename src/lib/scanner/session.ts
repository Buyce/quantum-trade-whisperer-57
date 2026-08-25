/**
 * Session algorithm versioning (Phase A1, Finding 9).
 *
 * P-Trades has only ever had ONE session algorithm: fixed UTC hour buckets, with
 * no daylight-saving adjustment and no market-local calendars. Phase A1 does not
 * change it — it registers it, so a future DST-aware model can be introduced as
 * version 2 without rewriting the meaning of a single historical row.
 *
 * WHAT `NULL` MEANS in `session_version`:
 *   Rows written before this version stamp existed. They were produced by this
 *   exact algorithm, but the code that wrote them did not record that fact, so
 *   they are reported as the named legacy cohort `v1-unstamped` rather than
 *   silently backfilled to 1. Statistics may group them WITH version 1 only when
 *   the analysis explicitly says so.
 */

/** Current session algorithm version. Do NOT bump without a new algorithm. */
export const SESSION_VERSION = 1 as const;

/** Name of the cohort formed by rows with a NULL session_version. */
export const LEGACY_SESSION_COHORT = "v1-unstamped" as const;

export const SESSION_NAMES = [
  "sydney",
  "tokyo",
  "london",
  "london_new_york_overlap",
  "new_york",
] as const;

export type SessionName = (typeof SESSION_NAMES)[number];

/**
 * The fixed-UTC boundaries, expressed as data so documentation, the database
 * reference row and the tests can all read the same source.
 */
export const SESSION_V1_BOUNDARIES: Record<SessionName, string> = {
  sydney: "22:00-01:00 UTC",
  tokyo: "01:00-07:00 UTC",
  london: "07:00-12:00 UTC",
  london_new_york_overlap: "12:00-16:00 UTC",
  new_york: "16:00-22:00 UTC",
};

export function isSessionName(value: unknown): value is SessionName {
  return typeof value === "string" && (SESSION_NAMES as readonly string[]).includes(value);
}
