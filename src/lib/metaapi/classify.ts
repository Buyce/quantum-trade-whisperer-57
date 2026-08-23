/**
 * Pure classification of BROKER-DERIVED account state.
 *
 * A user's onboarding choice ("I want to connect a demo account") is intent
 * only. Everything financial below is decided from MetaApi's own account
 * information, and an unreadable/unknown field NEVER resolves to the
 * permissive answer.
 */
import type {
  AccountMarginMode,
  AccountTradeMode,
  BrokerAccountInformation,
  ConnectionStatus,
  ProvisioningState,
} from "./types";

export type AccountType = "demo" | "real" | "contest" | "unknown";

export function classifyAccountType(info: Pick<BrokerAccountInformation, "type">): AccountType {
  switch (info.type as AccountTradeMode | null | undefined) {
    case "ACCOUNT_TRADE_MODE_DEMO":
      return "demo";
    case "ACCOUNT_TRADE_MODE_REAL":
      return "real";
    case "ACCOUNT_TRADE_MODE_CONTEST":
      return "contest";
    default:
      return "unknown";
  }
}

/** Read-only/investor connection. Trading is impossible regardless of mode. */
export function isReadOnly(info: BrokerAccountInformation): boolean {
  return info.investorMode === true || info.tradeAllowed !== true;
}

export function isMt5Netting(info: BrokerAccountInformation): boolean {
  return (
    (info.platform ?? null) === "mt5" &&
    (info.marginMode as AccountMarginMode | null) === "ACCOUNT_MARGIN_MODE_RETAIL_NETTING"
  );
}

/**
 * MetaApi's Risk Management API does not support MT5 netting accounts
 * (documented vendor limitation, treated as fact). We detect it and report the
 * feature as unavailable rather than pretending a tracker protects the account.
 */
export interface RiskGuardianAvailability {
  available: boolean;
  reason: string | null;
}

export function riskGuardianAvailability(
  info: BrokerAccountInformation,
  featureEnabled: boolean,
): RiskGuardianAvailability {
  if (isMt5Netting(info)) {
    return {
      available: false,
      reason:
        "MetaApi's Risk Management API does not support MT5 netting accounts, so Risk Guardian is unavailable for this account.",
    };
  }
  if (!featureEnabled) {
    return {
      available: false,
      reason: "The Risk Management API is not enabled on this MetaApi account.",
    };
  }
  return { available: true, reason: null };
}

export type AccountMode = "observe" | "demo_auto" | "live_confirm" | "live_auto";

export interface ModeEligibilityInput {
  info: BrokerAccountInformation;
  /** The user's explicit per-account opt-in. */
  userEnabled: boolean;
  /** Global product/regulatory gates. */
  globalDemoAuto: boolean;
  globalLiveConfirm: boolean;
  globalLiveAuto: boolean;
}

export interface ModeVerdict {
  allowed: boolean;
  reason: string | null;
}

const LIVE_OFF_REASON =
  "Live account connection is available for account monitoring. Automatic real-money execution is not currently enabled.";

/**
 * Whether a requested mode may be armed for this account RIGHT NOW.
 *
 * OBSERVE always works (including investor/read-only accounts). Everything that
 * can submit an order requires the broker's own account type, a tradable
 * connection, an explicit user opt-in AND the matching global gate.
 */
export function modeEligibility(mode: AccountMode, input: ModeEligibilityInput): ModeVerdict {
  const { info, userEnabled, globalDemoAuto, globalLiveConfirm, globalLiveAuto } = input;
  const type = classifyAccountType(info);

  if (mode === "observe") return { allowed: true, reason: null };

  if (isReadOnly(info)) {
    return {
      allowed: false,
      reason:
        info.investorMode === true
          ? "This account is connected with an investor (read-only) password, so P-Trades can monitor it but cannot place orders."
          : "The broker reports that trading is not allowed on this account right now.",
    };
  }
  if (!userEnabled) {
    return { allowed: false, reason: "You have not enabled this mode for this account." };
  }

  if (mode === "demo_auto") {
    if (type !== "demo") {
      return {
        allowed: false,
        reason: `Demo Auto requires a broker-confirmed demo account; this account is reported as ${type}.`,
      };
    }
    if (!globalDemoAuto) {
      return { allowed: false, reason: "Automatic demo execution is not enabled system-wide." };
    }
    return { allowed: true, reason: null };
  }

  // Live modes: broker-confirmed real account only, behind the product gate.
  if (type !== "real") {
    return {
      allowed: false,
      reason: `Live execution requires a broker-confirmed real account; this account is reported as ${type}.`,
    };
  }
  if (mode === "live_confirm" && !globalLiveConfirm) {
    return { allowed: false, reason: LIVE_OFF_REASON };
  }
  if (mode === "live_auto" && !globalLiveAuto) {
    return { allowed: false, reason: LIVE_OFF_REASON };
  }
  return { allowed: true, reason: null };
}

/**
 * Provisioning lifecycle, modelled explicitly so the wizard can never present
 * "credentials submitted" as "connected".
 */
export type ConnectionPhase =
  | "created"
  | "awaiting_credentials"
  | "deploying"
  | "deployed_not_connected"
  | "connected"
  | "broker_rejected"
  | "undeployed"
  | "failed";

export interface LifecycleInput {
  state: ProvisioningState | string | null | undefined;
  connectionStatus: ConnectionStatus | string | null | undefined;
  /** TRUE once MetaApi reports login credentials configured for the account. */
  credentialsConfigured: boolean;
}

export function connectionPhase(input: LifecycleInput): ConnectionPhase {
  const state = (input.state ?? "").toString().toUpperCase();
  const status = (input.connectionStatus ?? "").toString().toUpperCase();

  if (state === "DEPLOY_FAILED" || state === "UNDEPLOY_FAILED" || state === "REDEPLOY_FAILED") {
    return "failed";
  }
  if (!input.credentialsConfigured) {
    return state === "DRAFT" || state === "CREATED" || state === ""
      ? "awaiting_credentials"
      : "created";
  }
  if (state === "DEPLOYING") return "deploying";
  if (state === "UNDEPLOYED" || state === "UNDEPLOYING") return "undeployed";
  if (status === "CONNECTED") return "connected";
  if (status === "DISCONNECTED_FROM_BROKER") return "broker_rejected";
  if (state === "DEPLOYED") return "deployed_not_connected";
  return "created";
}

/** A connection is only READY once the Client API confirmed the account type. */
export function isReady(phase: ConnectionPhase, type: AccountType): boolean {
  return phase === "connected" && type !== "unknown";
}
