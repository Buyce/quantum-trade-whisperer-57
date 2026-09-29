/**
 * Provider-neutral broker boundary.
 *
 * MetaApi and the direct MT5 bridge must normalize broker truth into these
 * shapes before higher P-Trades layers consume it. This contract does not
 * grant execution permission.
 */
export type BrokerProvider = "metaapi" | "mt5_direct";
export type BrokerMode = "demo" | "live" | "contest" | "unknown";

export interface BrokerObservation {
  provider: BrokerProvider;
  observedAt: string;
}

export interface BrokerAccountSnapshot extends BrokerObservation {
  accountKey: string;
  platform: "mt4" | "mt5";
  mode: BrokerMode;
  loginMasked: string | null;
  server: string | null;
  broker: string | null;
  currency: string | null;
  balance: number | null;
  equity: number | null;
  margin: number | null;
  freeMargin: number | null;
  marginLevel: number | null;
  leverage: number | null;
  tradeAllowed: boolean | null;
}

export interface BrokerQuoteSnapshot extends BrokerObservation {
  symbol: string;
  bid: number;
  ask: number;
  sourceTime: string | null;
}

export interface BrokerPositionSnapshot extends BrokerObservation {
  id: string;
  symbol: string;
  side: "long" | "short" | "unknown";
  volume: number;
  openPrice: number | null;
  currentPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  profit: number | null;
}

export interface BrokerOrderSnapshot extends BrokerObservation {
  id: string;
  symbol: string;
  type: string;
  volume: number;
  openPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
}

export interface BrokerReadAdapter {
  readonly provider: BrokerProvider;
  account(): Promise<BrokerAccountSnapshot>;
  quote(symbol: string): Promise<BrokerQuoteSnapshot>;
  positions(): Promise<BrokerPositionSnapshot[]>;
  orders(): Promise<BrokerOrderSnapshot[]>;
}

export interface BrokerPreflightResult extends BrokerObservation {
  ok: boolean;
  brokerCode: string | number | null;
  message: string | null;
  margin: number | null;
}

/**
 * Execution is intentionally a separate capability. Merely implementing the
 * read adapter can never make a provider executable.
 */
export interface BrokerExecutionAdapter extends BrokerReadAdapter {
  preflight(input: unknown): Promise<BrokerPreflightResult>;
}
