import type {
  BrokerAccountSnapshot,
  BrokerOrderSnapshot,
  BrokerPositionSnapshot,
} from "../broker-gateway/types";

export const MT5_BRIDGE_PROTOCOL_VERSION = 1 as const;

export interface Mt5BridgeTerminal {
  connected: boolean;
  tradeAllowed: boolean | null;
  build: number | null;
  name: string | null;
  path: string | null;
}

export interface Mt5BridgeSnapshot {
  protocolVersion: typeof MT5_BRIDGE_PROTOCOL_VERSION;
  bridgeId: string;
  sequence: number;
  observedAt: string;
  terminal: Mt5BridgeTerminal;
  account: BrokerAccountSnapshot;
  positions: BrokerPositionSnapshot[];
  orders: BrokerOrderSnapshot[];
}

export interface Mt5BridgeHealth {
  protocolVersion: typeof MT5_BRIDGE_PROTOCOL_VERSION;
  bridgeId: string;
  observedAt: string;
  status: "healthy" | "degraded";
  reason: string | null;
}

export function validateMt5BridgeSnapshot(value: unknown): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["snapshot"];
  const row = value as Partial<Mt5BridgeSnapshot>;
  if (row.protocolVersion !== MT5_BRIDGE_PROTOCOL_VERSION) errors.push("protocol_version");
  if (typeof row.bridgeId !== "string" || !row.bridgeId.trim()) errors.push("bridge_id");
  if (!Number.isSafeInteger(row.sequence) || (row.sequence ?? -1) < 0) errors.push("sequence");
  if (typeof row.observedAt !== "string" || !Number.isFinite(Date.parse(row.observedAt))) {
    errors.push("observed_at");
  }
  if (!row.terminal || typeof row.terminal !== "object") errors.push("terminal");
  if (!row.account || typeof row.account !== "object") {
    errors.push("account");
  } else {
    if (row.account.provider !== "mt5_direct") errors.push("provider");
    if (row.account.platform !== "mt5") errors.push("platform");
    if (
      typeof row.account.observedAt !== "string" ||
      !Number.isFinite(Date.parse(row.account.observedAt))
    ) {
      errors.push("account_observed_at");
    }
  }
  if (!Array.isArray(row.positions)) errors.push("positions");
  if (!Array.isArray(row.orders)) errors.push("orders");
  return errors;
}
