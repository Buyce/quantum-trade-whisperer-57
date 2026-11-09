/**
 * Readable text for any thrown value. Database client errors are plain
 * objects ({ code, message }), which String() turns into "[object Object]"
 * and hides the real cause from health logs.
 */
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const e = err as { code?: unknown; message?: unknown };
    const msg = typeof e.message === "string" ? e.message : "";
    const code = typeof e.code === "string" ? e.code : "";
    if (msg || code) return code && msg ? `${code}: ${msg}` : msg || code;
    try {
      return JSON.stringify(err);
    } catch {
      return "unknown error";
    }
  }
  return String(err);
}
