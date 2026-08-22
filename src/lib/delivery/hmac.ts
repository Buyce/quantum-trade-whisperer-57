/**
 * Outbound request signing (payload version 2).
 *
 * HMAC-SHA256 over `timestamp.nonce.body`, so a receiver can verify authenticity
 * AND reject replays. The body `secret` field is retained for backwards
 * compatibility with the one live JSON receiver: signature-only verification is
 * an opt-in the receiver confirms, not a breaking change we impose.
 *
 * Web Crypto only — no Node built-ins — so it runs unchanged in the Worker.
 */

export const PAYLOAD_VERSION = 2;

/** Receivers must reject anything outside this window. */
export const SIGNATURE_WINDOW_SECONDS = 300;

export interface SignatureHeaders {
  "X-PTrades-Signature": string;
  "X-PTrades-Timestamp": string;
  "X-PTrades-Nonce": string;
  "X-PTrades-Payload-Version": string;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function signingBase(timestamp: string, nonce: string, body: string): string {
  return `${timestamp}.${nonce}.${body}`;
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toHex(sig);
}

/**
 * Signs a body. `nonce` and `timestamp` are injectable so tests are
 * deterministic; production callers omit them.
 */
export async function signBody(
  secret: string,
  body: string,
  opts: { timestamp?: string; nonce?: string } = {},
): Promise<SignatureHeaders> {
  const timestamp = opts.timestamp ?? String(Math.floor(Date.now() / 1000));
  const nonce = opts.nonce ?? crypto.randomUUID();
  const signature = await hmacSha256Hex(secret, signingBase(timestamp, nonce, body));
  return {
    "X-PTrades-Signature": `sha256=${signature}`,
    "X-PTrades-Timestamp": timestamp,
    "X-PTrades-Nonce": nonce,
    "X-PTrades-Payload-Version": String(PAYLOAD_VERSION),
  };
}

/** Stable, non-secret identity of a request — safe to persist for forensics. */
export async function requestFingerprint(body: string, nonce: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${nonce}.${body}`),
  );
  return toHex(digest).slice(0, 32);
}
