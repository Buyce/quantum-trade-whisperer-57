/**
 * Shared-secret gate for the cron and worker endpoints.
 *
 * Accepts either CRON_SECRET (external schedulers / manual runs) or
 * SCANNER_TRIGGER_SECRET (used by the in-database scan_queue trigger).
 * Comparison is constant-time-ish and never leaks which secret matched.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function authorizeCronRequest(request: Request): boolean {
  const presented =
    request.headers.get("x-cron-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  if (!presented) return false;

  const accepted = [process.env["CRON_SECRET"], process.env["SCANNER_TRIGGER_SECRET"]].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  return accepted.some((secret) => safeEqual(presented, secret));
}

export function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
