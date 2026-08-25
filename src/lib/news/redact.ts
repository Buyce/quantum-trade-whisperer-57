/**
 * Credential redaction for anything that may be logged, stored or returned.
 *
 * Some official APIs (FRED) only accept the key as a query parameter, so the
 * request URL itself is a secret. Every diagnostic path therefore goes through
 * `redactUrl` / `redactText` before it reaches a log line, an ingestion-run row or
 * an error message.
 */

/** Query parameters whose value must never appear anywhere. */
const SECRET_PARAMS = ["api_key", "apikey", "key", "token", "access_token", "auth"];

export function redactUrl(input: string): string {
  try {
    const url = new URL(input);
    for (const param of SECRET_PARAMS) {
      if (url.searchParams.has(param)) url.searchParams.set(param, "REDACTED");
    }
    return url.toString();
  } catch {
    // Not a URL: fall back to pattern redaction.
    return input.replace(
      new RegExp(`([?&](?:${SECRET_PARAMS.join("|")})=)[^&\\s]+`, "gi"),
      "$1REDACTED",
    );
  }
}

/**
 * Redact URLs and any literal secret values from free text.
 *
 * `secrets` are compared literally: a value long enough to be a credential is
 * replaced wherever it appears, so a provider echoing the key back cannot leak it
 * through our own error note.
 */
export function redactText(input: string, secrets: (string | undefined)[] = []): string {
  let out = input.replace(/https?:\/\/\S+/g, (match) => redactUrl(match));
  out = out.replace(
    new RegExp(`([?&](?:${SECRET_PARAMS.join("|")})=)[^&\\s"']+`, "gi"),
    "$1REDACTED",
  );
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 8) {
      out = out.split(secret).join("REDACTED");
    }
  }
  return out;
}

/** Bounded, redacted note suitable for the ingestion ledger. */
export function safeNote(
  input: unknown,
  secrets: (string | undefined)[] = [],
  maxLength = 300,
): string | null {
  if (input === null || input === undefined) return null;
  const raw = input instanceof Error ? input.message : String(input);
  const redacted = redactText(raw, secrets);
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}…` : redacted;
}
