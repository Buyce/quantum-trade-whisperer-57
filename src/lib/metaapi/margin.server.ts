/**
 * Broker margin estimate for a prospective order.
 *
 * When the broker answers with a finite numeric value, the figure is
 * broker-derived and may be labelled as such. Missing or invalid values throw;
 * a locally invented margin number is never substituted.
 */
import { metaApiRequest } from "./request.server";
import type { MetaApiRequestObservation } from "./request.server";
import { MetaApiInvalidResponseError } from "./errors";
import type { MarginRequest, MarginResponse } from "./types";

export interface MarginResponseInspection {
  marginExists: boolean;
  rawMarginType: "missing" | "null" | "number" | "string" | "boolean" | "object" | "undefined";
  marginFinite: boolean;
  marginValue: number | null;
}

export interface MarginDiagnosticHooks {
  onRequestObservation?: (observation: MetaApiRequestObservation) => void;
  onResponseInspection?: (inspection: MarginResponseInspection) => void;
}

export function inspectMarginResponse(raw: MarginResponse | null): MarginResponseInspection {
  const marginExists = Boolean(
    raw && typeof raw === "object" && Object.prototype.hasOwnProperty.call(raw, "margin"),
  );
  const margin = raw?.margin;
  const rawMarginType: MarginResponseInspection["rawMarginType"] = !marginExists
    ? "missing"
    : margin === null
      ? "null"
      : typeof margin === "number"
        ? "number"
        : typeof margin === "string"
          ? "string"
          : typeof margin === "boolean"
            ? "boolean"
            : typeof margin === "undefined"
              ? "undefined"
              : "object";
  const marginFinite = typeof margin === "number" && Number.isFinite(margin) && margin >= 0;
  return {
    marginExists,
    rawMarginType,
    marginFinite,
    marginValue: marginFinite ? margin : null,
  };
}

export async function estimateMargin(
  accountId: string,
  region: string,
  request: MarginRequest,
  diagnostics?: MarginDiagnosticHooks,
): Promise<number> {
  const res = await metaApiRequest<MarginResponse>({
    service: "client",
    region,
    method: "POST",
    label: `${request.symbol} margin`,
    path: `/users/current/accounts/${accountId}/calculate-margin`,
    body: request,
    ...(diagnostics?.onRequestObservation
      ? { onObservation: diagnostics.onRequestObservation }
      : {}),
  });
  const inspection = inspectMarginResponse(res);
  diagnostics?.onResponseInspection?.(inspection);
  const margin = inspection.marginValue;
  // MetaApi documents a JSON number. Numeric zero is deliberately accepted;
  // null, strings and non-finite values are not coerced into broker authority.
  if (!inspection.marginFinite || margin === null) {
    throw new MetaApiInvalidResponseError(
      `${request.symbol} margin`,
      `expected a finite non-negative numeric margin, received ${inspection.rawMarginType}`,
    );
  }
  return margin;
}
