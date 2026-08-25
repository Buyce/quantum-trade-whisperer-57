/**
 * How the Feed strip describes an instrument.
 *
 * Feed reachability alone is NOT a claim of availability: a pair in measurement
 * has a reachable broker feed while still being forbidden from publishing,
 * alerting or executing.
 */
import type { InstrumentCapability } from "@/lib/db-types";

export function feedChipLabel(available: boolean, capability: InstrumentCapability): string {
  if (!available) return "feed down";
  if (capability === "publishable") return "live feed";
  if (capability === "measuring") return "measuring — not published yet";
  return "not in service";
}
