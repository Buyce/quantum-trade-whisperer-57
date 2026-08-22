/**
 * THE outbound endpoint validator. One implementation, used by both save-time
 * validation and the dispatcher — there is deliberately no frontend-only regex,
 * because a client-side check is decoration, not a security boundary.
 *
 * Order matters: parse (WHATWG) → syntactic rules → resolve (DoH A/AAAA) →
 * classify every resolved address. A hostname that resolves to any non-public
 * address is rejected outright, and dispatch uses `redirect: "manual"` so a
 * 302 into private space cannot be followed.
 *
 * Residual risk we cannot close in this runtime: the Worker cannot pin the
 * resolved address onto the socket, so a DNS rebind between validation and
 * connect remains theoretically possible. Mitigated by resolve-then-validate at
 * BOTH save and send time, and by refusing redirects.
 */

export type UrlRejectionReason =
  | "unparseable"
  | "scheme_not_https"
  | "userinfo_present"
  | "port_not_443"
  | "hostname_missing"
  | "hostname_is_ip_literal_private"
  | "hostname_blocklisted"
  | "resolution_failed"
  | "validation_unavailable"
  | "resolves_to_private_address";

export interface UrlValidationOk {
  ok: true;
  url: string;
  host: string;
  addresses: string[];
  validatedAt: string;
}

export interface UrlValidationError {
  ok: false;
  reason: UrlRejectionReason;
  detail: string;
  /** True when we could not decide — callers must fail closed, never "allow once". */
  unavailable: boolean;
}

export type UrlValidation = UrlValidationOk | UrlValidationError;

export const URL_REJECTION_COPY: Record<UrlRejectionReason, string> = {
  unparseable: "That is not a valid URL.",
  scheme_not_https: "The bridge URL must use https.",
  userinfo_present: "The bridge URL must not contain a username or password.",
  port_not_443: "The bridge URL must use the default https port (443).",
  hostname_missing: "The bridge URL has no hostname.",
  hostname_is_ip_literal_private: "The bridge URL points at a non-public address.",
  hostname_blocklisted: "That hostname is not allowed.",
  resolution_failed: "That hostname could not be resolved.",
  validation_unavailable:
    "Endpoint validation is temporarily unavailable, so the URL was not accepted.",
  resolves_to_private_address: "That hostname resolves to a non-public address.",
};

/** Hostnames that never legitimately host a user's broker bridge. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain"];

function parseIpv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n >= 0 && n <= 255) ? parts : null;
}

/**
 * Public-address classification. Everything not provably public is private:
 * loopback, RFC1918, link-local (incl. 169.254.169.254), CGNAT, multicast,
 * broadcast, reserved, IPv6 loopback/ULA/link-local, and IPv4-mapped IPv6.
 */
export function isPublicAddress(address: string): boolean {
  const addr = address.trim().toLowerCase();
  if (!addr) return false;

  const v4 = parseIpv4(addr);
  if (v4) {
    const [a, b] = v4 as [number, number, number, number];
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0) return false; // 192.0.0.0/24, 192.0.2.0/24
    if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
    if (a === 198 && b === 51) return false; // documentation
    if (a === 203 && b === 0) return false; // documentation
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a >= 224) return false; // multicast + reserved + broadcast
    return true;
  }

  if (addr.includes(":")) {
    // IPv4-mapped / IPv4-compatible: classify the embedded IPv4 instead.
    const mapped = /(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/.exec(addr);
    if (mapped?.[1]) return isPublicAddress(mapped[1]);
    if (addr === "::" || addr === "::1") return false;
    if (addr.startsWith("fe8") || addr.startsWith("fe9")) return false; // link-local
    if (addr.startsWith("fea") || addr.startsWith("feb")) return false;
    if (addr.startsWith("fc") || addr.startsWith("fd")) return false; // unique-local
    if (addr.startsWith("ff")) return false; // multicast
    return true;
  }

  return false;
}

/** Syntactic checks only — no network. Shared by save-time and send-time paths. */
export function inspectUrlSyntax(raw: string): UrlValidationError | { ok: true; url: URL } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "unparseable", detail: "URL parse failed", unavailable: false };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "scheme_not_https", detail: url.protocol, unavailable: false };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "userinfo_present", detail: "credentials in URL", unavailable: false };
  }
  if (url.port && url.port !== "443") {
    return { ok: false, reason: "port_not_443", detail: url.port, unavailable: false };
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) {
    return { ok: false, reason: "hostname_missing", detail: "", unavailable: false };
  }
  if (BLOCKED_HOSTNAMES.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: "hostname_blocklisted", detail: host, unavailable: false };
  }
  // Literal addresses skip DNS entirely and are classified directly.
  const isLiteral = parseIpv4(host) !== null || host.includes(":");
  if (isLiteral && !isPublicAddress(host)) {
    return {
      ok: false,
      reason: "hostname_is_ip_literal_private",
      detail: host,
      unavailable: false,
    };
  }
  return { ok: true, url };
}

const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";
const DOH_TIMEOUT_MS = 4_000;

interface DohAnswer {
  type: number;
  data: string;
}

async function resolveRecords(host: string, type: "A" | "AAAA"): Promise<string[] | null> {
  try {
    const res = await fetch(`${DOH_ENDPOINT}?name=${encodeURIComponent(host)}&type=${type}`, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(DOH_TIMEOUT_MS),
      redirect: "manual",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { Status?: number; Answer?: DohAnswer[] } | null;
    if (!json || typeof json.Status !== "number") return null;
    // NXDOMAIN / NODATA are legitimate answers, not resolver failures.
    if (json.Status !== 0) return [];
    const wanted = type === "A" ? 1 : 28;
    return (json.Answer ?? []).filter((a) => a.type === wanted).map((a) => a.data);
  } catch {
    return null;
  }
}

/**
 * Full validation: parse → resolve → classify. Fails CLOSED — if the resolver is
 * unreachable the URL is not accepted "just this once"; the previously validated
 * URL keeps working untouched.
 */
export async function validateOutboundUrl(raw: string): Promise<UrlValidation> {
  const syntax = inspectUrlSyntax(raw);
  if (!syntax.ok) return syntax;
  const url = syntax.url;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (parseIpv4(host) !== null || host.includes(":")) {
    // Already classified as public by the syntax pass.
    return {
      ok: true,
      url: url.toString(),
      host,
      addresses: [host],
      validatedAt: new Date().toISOString(),
    };
  }

  const [a, aaaa] = await Promise.all([resolveRecords(host, "A"), resolveRecords(host, "AAAA")]);
  if (a === null && aaaa === null) {
    return {
      ok: false,
      reason: "validation_unavailable",
      detail: "DNS-over-HTTPS resolver unavailable",
      unavailable: true,
    };
  }
  const addresses = [...(a ?? []), ...(aaaa ?? [])];
  if (!addresses.length) {
    return {
      ok: false,
      reason: "resolution_failed",
      detail: host,
      unavailable: false,
    };
  }
  const offending = addresses.filter((addr) => !isPublicAddress(addr));
  if (offending.length) {
    return {
      ok: false,
      reason: "resolves_to_private_address",
      detail: offending.join(", "),
      unavailable: false,
    };
  }
  return {
    ok: true,
    url: url.toString(),
    host,
    addresses,
    validatedAt: new Date().toISOString(),
  };
}
