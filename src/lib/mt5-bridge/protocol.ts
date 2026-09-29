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

export function validateMt5BridgeSnapshot(value: Mt5BridgeSnapshot): string[] {
  const errors: string[] = [];
  if (value.protocolVersion !== MT5_BRIDGE_PROTOCOL_VERSION) errors.push("protocol_version");
  if (!value.bridgeId.trim()) errors.push("bridge_id");
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 0) errors.push("sequence");
  if (!Number.isFinite(Date.parse(value.observedAt))) errors.push("observed_at");
  if (value.account.provider !== "mt5_direct") errors.push("provider");
  if (value.account.platform !== "mt5") errors.push("platform");
  if (!Number.isFinite(Date.parse(value.account.observedAt))) errors.push("account_observed_at");
  return errors;
}
