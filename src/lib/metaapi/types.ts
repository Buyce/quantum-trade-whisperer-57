/**
 * MetaApi wire shapes, narrowed to the fields P-Trades actually reads.
 *
 * Deliberately partial and permissive: an unknown broker field stays unknown
 * rather than being defaulted to a number that would then be presented as
 * broker-confirmed.
 */

export type MetaApiPlatform = "mt4" | "mt5";

export type AccountTradeMode =
  | "ACCOUNT_TRADE_MODE_DEMO"
  | "ACCOUNT_TRADE_MODE_REAL"
  | "ACCOUNT_TRADE_MODE_CONTEST";

export type AccountMarginMode =
  | "ACCOUNT_MARGIN_MODE_RETAIL_NETTING"
  | "ACCOUNT_MARGIN_MODE_RETAIL_HEDGING"
  | "ACCOUNT_MARGIN_MODE_EXCHANGE";

/** Provisioning `state` values, per the TradingAccount model. */
export type ProvisioningState =
  | "CREATED"
  | "DEPLOYING"
  | "DEPLOYED"
  | "DEPLOY_FAILED"
  | "UNDEPLOYING"
  | "UNDEPLOYED"
  | "UNDEPLOY_FAILED"
  | "DELETING"
  | "DELETE_FAILED"
  | "REDEPLOY_FAILED"
  | "DRAFT";

export type ConnectionStatus = "CONNECTED" | "DISCONNECTED" | "DISCONNECTED_FROM_BROKER";

/** Provisioning API account row (subset). */
export interface ProvisionedAccount {
  _id: string;
  name?: string | null;
  platform?: MetaApiPlatform | null;
  server?: string | null;
  region?: string | null;
  state?: ProvisioningState | string | null;
  connectionStatus?: ConnectionStatus | string | null;
  reliability?: string | null;
  metastatsApiEnabled?: boolean | null;
  riskManagementApiEnabled?: boolean | null;
  manualTrades?: boolean | null;
  magic?: number | null;
  login?: string | number | null;
}

/** Client API account information (subset). */
export interface BrokerAccountInformation {
  platform?: MetaApiPlatform | null;
  broker?: string | null;
  currency?: string | null;
  server?: string | null;
  balance?: number | null;
  equity?: number | null;
  margin?: number | null;
  freeMargin?: number | null;
  marginLevel?: number | null;
  leverage?: number | null;
  tradeAllowed?: boolean | null;
  investorMode?: boolean | null;
  marginMode?: AccountMarginMode | string | null;
  type?: AccountTradeMode | string | null;
  name?: string | null;
  login?: number | string | null;
}

export interface BrokerPosition {
  id?: string | null;
  symbol?: string | null;
  type?: string | null;
  volume?: number | null;
  openPrice?: number | null;
  currentPrice?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  profit?: number | null;
  swap?: number | null;
  commission?: number | null;
  magic?: number | null;
  clientId?: string | null;
  comment?: string | null;
  time?: string | null;
  brokerTime?: string | null;
}

export interface BrokerOrder {
  id?: string | null;
  symbol?: string | null;
  type?: string | null;
  volume?: number | null;
  currentVolume?: number | null;
  openPrice?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  magic?: number | null;
  clientId?: string | null;
  comment?: string | null;
  state?: string | null;
  time?: string | null;
  doneTime?: string | null;
  positionId?: string | null;
}

export interface BrokerDeal {
  id?: string | null;
  orderId?: string | null;
  positionId?: string | null;
  symbol?: string | null;
  type?: string | null;
  entryType?: string | null;
  volume?: number | null;
  price?: number | null;
  commission?: number | null;
  swap?: number | null;
  profit?: number | null;
  magic?: number | null;
  clientId?: string | null;
  comment?: string | null;
  time?: string | null;
  brokerTime?: string | null;
}

/** Documented pending-order action types P-Trades submits. */
export type PendingOrderActionType = "ORDER_TYPE_BUY_LIMIT" | "ORDER_TYPE_SELL_LIMIT";

export interface PendingOrderRequest {
  actionType: PendingOrderActionType;
  symbol: string;
  volume: number;
  openPrice: number;
  stopLoss: number;
  takeProfit: number;
  /** ISO-8601 expiration instant; sent as ORDER_TIME_SPECIFIED. */
  expirationTime: string;
  clientId: string;
  magic: number;
  comment?: string;
}

export interface TradeResponse {
  numericCode?: number | null;
  stringCode?: string | null;
  message?: string | null;
  orderId?: string | null;
  positionId?: string | null;
  tradeExecutionId?: string | null;
}

export interface MarginRequest {
  symbol: string;
  type: PendingOrderActionType;
  volume: number;
  openPrice: number;
}

export interface MarginResponse {
  margin?: number | null;
}

export interface SymbolSpecification {
  symbol?: string | null;
  contractSize?: number | null;
  digits?: number | null;
  point?: number | null;
  tickSize?: number | null;
  minVolume?: number | null;
  maxVolume?: number | null;
  volumeStep?: number | null;
  volumeLimit?: number | null;
  stopsLevel?: number | null;
  freezeLevel?: number | null;
  marginCalculationMode?: string | null;
  baseCurrency?: string | null;
  profitCurrency?: string | null;
  quoteCurrency?: string | null;
}
