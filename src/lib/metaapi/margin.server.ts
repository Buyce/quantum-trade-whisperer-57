/**
 * Broker margin estimate for a prospective order.
 *
 * When the broker answers, the figure is broker-derived and may be labelled as
 * such. When it does not, we return `null` and the UI keeps saying "estimate
 * unavailable" — a locally invented margin number is never substituted.
 */
import { metaApiRequest } from "./request.server";
import type { MarginRequest, MarginResponse } from "./types";

export async function estimateMargin(
  accountId: string,
  region: string,
  request: MarginRequest,
): Promise<number | null> {
  const res = await metaApiRequest<MarginResponse>({
    service: "client",
    region,
    method: "POST",
    label: `${request.symbol} margin`,
    path: `/users/current/accounts/${accountId}/calculate-margin`,
    body: request,
  });
  const margin = Number(res?.margin);
  return Number.isFinite(margin) ? margin : null;
}
