/**
 * Risk Management API (drawdown trackers, equity chart).
 *
 * Availability is decided by `riskGuardianAvailability` BEFORE any call here:
 * MT5 netting accounts are not supported by this vendor API, and we report that
 * plainly instead of implying a tracker is watching the account.
 */
import { metaApiRequest } from "./request.server";

const RISK = { service: "risk-management" as const };

export interface TrackerInput {
  name: string;
  /** `absoluteDrawdown` or `relativeDrawdown` thresholds, per the vendor API. */
  absoluteDrawdownThreshold?: number;
  relativeDrawdownThreshold?: number;
  period: "day" | "date" | "week" | "week-to-date" | "month" | "month-to-date" | "quarter" | "year";
}

export async function createTracker(
  accountId: string,
  region: string | null,
  tracker: TrackerInput,
): Promise<{ id: string } | null> {
  return await metaApiRequest<{ id: string }>({
    ...RISK,
    region,
    method: "POST",
    label: "create tracker",
    path: `/users/current/accounts/${accountId}/trackers`,
    body: tracker,
  });
}

export async function listTrackers(
  accountId: string,
  region: string | null,
): Promise<Record<string, unknown>[]> {
  const raw = await metaApiRequest<Record<string, unknown>[]>({
    ...RISK,
    region,
    label: "list trackers",
    path: `/users/current/accounts/${accountId}/trackers`,
  });
  return Array.isArray(raw) ? raw : [];
}

export async function deleteTracker(
  accountId: string,
  region: string | null,
  trackerId: string,
): Promise<void> {
  await metaApiRequest({
    ...RISK,
    region,
    method: "DELETE",
    label: "delete tracker",
    path: `/users/current/accounts/${accountId}/trackers/${trackerId}`,
  });
}

export async function fetchTrackerEvents(
  accountId: string,
  region: string | null,
  trackerId: string,
  limit = 100,
): Promise<Record<string, unknown>[]> {
  const raw = await metaApiRequest<Record<string, unknown>[]>({
    ...RISK,
    region,
    label: "tracker events",
    path: `/users/current/accounts/${accountId}/trackers/${trackerId}/tracker-events?limit=${limit}`,
  });
  return Array.isArray(raw) ? raw : [];
}

export async function fetchEquityChart(
  accountId: string,
  region: string | null,
  startTime?: Date,
  endTime?: Date,
): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams();
  if (startTime) params.set("startTime", startTime.toISOString());
  if (endTime) params.set("endTime", endTime.toISOString());
  const query = params.toString();
  const raw = await metaApiRequest<Record<string, unknown>[]>({
    ...RISK,
    region,
    label: "equity chart",
    path: `/users/current/accounts/${accountId}/equity-chart${query ? `?${query}` : ""}`,
  });
  return Array.isArray(raw) ? raw : [];
}
