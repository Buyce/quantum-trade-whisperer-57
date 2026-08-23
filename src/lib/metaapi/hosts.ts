/**
 * The ONE region → trusted-host resolver.
 *
 * A hostname is NEVER accepted from a user, a request body or a database row a
 * user can write. A region string only ever comes from MetaApi's own account
 * metadata (or server configuration for the benchmark account), and it must
 * additionally match this strict shape before being interpolated into a host.
 * Anything else fails closed with `null`.
 *
 * Pure: no fetch, no env, no clock.
 */

export type MetaApiService =
  | "provisioning"
  | "client"
  | "market-data"
  | "metastats"
  | "risk-management";

/** Region ids are lowercase alphanumerics joined by single dashes: `new-york`. */
const REGION_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_REGION_LENGTH = 32;

const ROOT = "agiliumtrade.ai";

/**
 * Provisioning is served from the vendor's own double-suffix domain. Verified
 * against the live service: `mt-provisioning-api-v1.agiliumtrade.ai` does not
 * resolve at all (the edge answers 530 / 1016), while
 * `mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai` answers normally.
 */
const PROVISIONING_ROOT = `agiliumtrade.${ROOT}`;

type RegionalService = Exclude<MetaApiService, "provisioning">;
type GlobalService = Extract<MetaApiService, "provisioning">;

/**
 * Regional service prefixes, per MetaApi's documented API-access hosts.
 * MetaStats and Risk Management are region-scoped exactly like the trading
 * hosts; their non-regional forms do not resolve.
 */
const REGIONAL_PREFIX: Record<RegionalService, string> = {
  client: "mt-client-api-v1",
  "market-data": "mt-market-data-client-api-v1",
  metastats: "metastats-api-v1",
  "risk-management": "risk-management-api-v1",
};

/** Global (non-regional) services. */
const GLOBAL_PREFIX: Record<GlobalService, string> = {
  provisioning: "mt-provisioning-api-v1",
};


export function isValidRegion(region: unknown): region is string {
  return (
    typeof region === "string" &&
    region.length > 0 &&
    region.length <= MAX_REGION_LENGTH &&
    REGION_RE.test(region)
  );
}

function isRegional(service: MetaApiService): service is RegionalService {
  return service !== "provisioning";
}

/**
 * Resolve a MetaApi service host. Returns `null` for an untrusted or malformed
 * region rather than guessing a default — a wrong host is a silent
 * cross-tenant/SSRF risk, so callers must handle the refusal explicitly.
 */
export function resolveHost(service: MetaApiService, region?: string | null): string | null {
  if (isRegional(service)) {
    if (!isValidRegion(region)) return null;
    return `https://${REGIONAL_PREFIX[service]}.${region}.${ROOT}`;
  }
  return `https://${GLOBAL_PREFIX[service]}.${PROVISIONING_ROOT}`;
}

/** TRUE only for hosts this resolver itself can produce. */
export function isTrustedMetaApiHost(host: string): boolean {
  try {
    const url = new URL(host);
    if (url.protocol !== "https:") return false;

    const globalSuffix = `.${PROVISIONING_ROOT}`;
    if (url.hostname.endsWith(globalSuffix)) {
      const label = url.hostname.slice(0, -globalSuffix.length);
      return (Object.values(GLOBAL_PREFIX) as string[]).includes(label);
    }

    const suffix = `.${ROOT}`;
    if (!url.hostname.endsWith(suffix)) return false;
    const labels = url.hostname.slice(0, -suffix.length).split(".");
    if (labels.length === 2) {
      return (
        (Object.values(REGIONAL_PREFIX) as string[]).includes(labels[0]!) &&
        isValidRegion(labels[1] ?? null)
      );
    }
    return false;
  } catch {
    return false;
  }

}
