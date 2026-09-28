/**
 * Runtime Validation report shape and allow-list sanitizer.
 * Only the fields named here can ever leave the server.
 */
export const GATES = [
  "connection",
  "broker_facts",
  "account_permissions",
  "risk_policy",
  "symbol_mapping",
  "quote_and_spec",
  "sizing",
  "margin",
  "reconciliation",
] as const;
export type GateName = (typeof GATES)[number];
export type GateStatus = "PASS" | "FAIL" | "NOT_REACHED";

export interface GateResult {
  gate: GateName;
  status: GateStatus;
  reason: string | null;
}

export interface ValidationReport {
  dry_run: true;
  trade_endpoint_called: false;
  account_id: string;
  label: string | null;
  classification: "demo" | "real" | "contest" | "unknown" | null;
  connection_state: string | null;
  balance: number | null;
  equity: number | null;
  free_margin: number | null;
  currency: string | null;
  broker_observed_at: string | null;
  policy_id: string | null;
  risk_percent: number | null;
  risk_amount: number | null;
  canonical_symbol: string;
  broker_symbol: string | null;
  lots: number | null;
  required_margin: number | null;
  gates: GateResult[];
  passed: boolean;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" ? v : null);

/** Copies only allow-listed keys; anything else (tokens, provider ids) is dropped. */
export function sanitizeReport(raw: Record<string, unknown>): ValidationReport {
  const gates = Array.isArray(raw["gates"]) ? (raw["gates"] as GateResult[]) : [];
  const cls = str(raw["classification"]);
  return {
    dry_run: true,
    trade_endpoint_called: false,
    account_id: String(raw["account_id"] ?? ""),
    label: str(raw["label"]),
    classification:
      cls === "demo" || cls === "real" || cls === "contest" || cls === "unknown" ? cls : null,
    connection_state: str(raw["connection_state"]),
    balance: num(raw["balance"]),
    equity: num(raw["equity"]),
    free_margin: num(raw["free_margin"]),
    currency: str(raw["currency"]),
    broker_observed_at: str(raw["broker_observed_at"]),
    policy_id: str(raw["policy_id"]),
    risk_percent: num(raw["risk_percent"]),
    risk_amount: num(raw["risk_amount"]),
    canonical_symbol: String(raw["canonical_symbol"] ?? ""),
    broker_symbol: str(raw["broker_symbol"]),
    lots: num(raw["lots"]),
    required_margin: num(raw["required_margin"]),
    gates: gates.map((g) => ({ gate: g.gate, status: g.status, reason: g.reason ?? null })),
    passed: gates.length === GATES.length && gates.every((g) => g.status === "PASS"),
  };
}
