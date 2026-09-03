/**
 * Safe UTC timestamp formatting.
 *
 * `new Date(x).toISOString()` throws a RangeError on a null, empty or
 * malformed timestamp. Inside a React render that escalates to the nearest
 * error boundary and can blank a whole page, so every admin surface formats
 * timestamps through here: an unreadable value degrades to an em dash instead
 * of throwing.
 */

/** `YYYY-MM-DD HH:MM` in UTC, or "—" when the value is not a readable date. */
export function utcMinute(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16);
}
