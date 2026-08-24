/**
 * The connected-account lifecycle, expressed as pure functions.
 *
 * Two hard rules from the Prompt-14 lock live here:
 *
 *  1. The demo/live choice a trader makes during onboarding is INTENT ONLY.
 *     MetaApi's own account information decides whether the account is demo,
 *     real or contest. When the two disagree the connection is stopped and the
 *     trader is warned in plain language — it is never silently accepted.
 *  2. A connection is only READY once the broker itself confirmed the account
 *     type. "Credentials submitted" is never presented as "connected".
 *
 * Pure: no fetch, no env, no clock.
 */
import type { AccountType, ConnectionPhase } from "@/lib/metaapi/classify";

export type ConnectionIntent = "demo" | "live";

/** Persisted phase vocabulary: the MetaApi lifecycle plus our terminal READY. */
export type AccountPhase = ConnectionPhase | "ready";

export interface IntentVerdict {
  conflict: boolean;
  /** Present whenever `conflict` is true; user-facing prose. */
  reason: string | null;
}

/**
 * Compare onboarding intent with the broker's authoritative answer.
 *
 * `unknown` is NOT a conflict — it is an absent answer, and the connection
 * simply cannot become READY until the broker reports a type.
 */
export function evaluateIntent(intent: ConnectionIntent, type: AccountType): IntentVerdict {
  if (type === "unknown") return { conflict: false, reason: null };

  if (intent === "demo" && type !== "demo") {
    return {
      conflict: true,
      reason:
        type === "real"
          ? "You chose to connect a DEMO account, but your broker reports this as a REAL money account. P-Trades has stopped here on purpose. Disconnect it, or start again and choose Live if you really meant this account."
          : "You chose to connect a DEMO account, but your broker reports this as a CONTEST account. P-Trades has stopped here — contest accounts are not treated as demo accounts.",
    };
  }
  if (intent === "live" && type !== "real") {
    return {
      conflict: true,
      reason: `You chose to connect a LIVE account, but your broker reports this as a ${type.toUpperCase()} account. P-Trades has stopped here so nothing is mislabelled — start again and choose Demo if that is what this account is.`,
    };
  }
  return { conflict: false, reason: null };
}

export interface ReadinessInput {
  phase: AccountPhase;
  brokerAccountType: AccountType;
  intentConflict: boolean;
}

/** READY = broker connected, broker type known, and intent not contradicted. */
export function isConnectionReady(input: ReadinessInput): boolean {
  return (
    (input.phase === "connected" || input.phase === "ready") &&
    input.brokerAccountType !== "unknown" &&
    !input.intentConflict
  );
}

export interface PhaseCopy {
  label: string;
  detail: string;
  /** `pending` = waiting on the trader, `working` = waiting on MetaApi/broker. */
  tone: "pending" | "working" | "ok" | "error";
  /** What the trader should do next, or null when nothing is required of them. */
  nextAction: string | null;
}

/**
 * Failure and waiting states are spelled out, because "it didn't work" is the
 * single biggest support cost in broker onboarding.
 */
export function describePhase(phase: AccountPhase): PhaseCopy {
  switch (phase) {
    case "awaiting_credentials":
      return {
        label: "Waiting for your broker login",
        detail:
          "P-Trades created the connection slot. Your MetaTrader login and password are entered on your broker-connection provider's own secure page — P-Trades never sees or stores them.",
        tone: "pending",
        nextAction: "Open the secure connection page and enter your MetaTrader login details.",
      };
    case "created":
      return {
        label: "Provider is still creating the connection",
        detail:
          "The provider accepted this attempt but has not returned the account yet. P-Trades kept the same transaction id, so Refresh continues that attempt instead of creating a duplicate.",
        tone: "working",
        nextAction: "Wait for the provider's retry window, then press Refresh.",
      };
    case "deploying":
      return {
        label: "Starting up",
        detail:
          "Your broker connection is being started. This usually takes a few minutes the first time.",
        tone: "working",
        nextAction: null,
      };
    case "deployed_not_connected":
      return {
        label: "Started, not yet talking to your broker",
        detail:
          "The connection is running but your broker has not accepted it yet. This is normal for the first few minutes, and can also mean the broker server name is slightly wrong.",
        tone: "working",
        nextAction: "Wait a few minutes, then refresh. If it stays here, re-check the server name.",
      };
    case "broker_rejected":
      return {
        label: "Your broker refused the login",
        detail:
          "The connection reached your broker, but the broker rejected the credentials or the server. The usual causes are a wrong server name, a typo in the login, an expired demo, or an investor password used where a trading password is needed.",
        tone: "error",
        nextAction: "Re-enter your login details on the secure connection page.",
      };
    case "connected":
      return {
        label: "Connected — verifying with your broker",
        detail:
          "Your broker is connected. P-Trades is reading the account information it reports, which is what decides whether this is a demo or a real account.",
        tone: "working",
        nextAction: null,
      };
    case "ready":
      return {
        label: "Ready",
        detail:
          "Your broker confirmed this account. Every figure shown for it comes from your broker, not from P-Trades.",
        tone: "ok",
        nextAction: null,
      };
    case "undeployed":
      return {
        label: "Stopped",
        detail: "This connection is currently stopped and is not talking to your broker.",
        tone: "pending",
        nextAction: "Refresh the connection to start it again.",
      };
    case "failed":
      return {
        label: "Connection failed",
        detail:
          "Your broker-connection provider could not start this connection. Nothing was traded and nothing was charged to your broker account.",
        tone: "error",
        nextAction: "Disconnect this account and try again, or contact support.",
      };
  }
}

export interface DisconnectPlan {
  /** Remove the account at MetaApi as well, so it stops being billable. */
  removeRemote: boolean;
  /** Recorded history is NEVER deleted by a disconnect. */
  keepsHistory: true;
  summary: string;
}

export interface DisconnectInput {
  hasRemoteAccount: boolean;
  /**
   * The stored provider account is the reserved P-Trades engine account. It must
   * never be undeployed or deleted on a customer's behalf, but the customer
   * connection pointing at it must still be removable.
   */
  reservedRemote?: boolean;
  /**
   * The owner explicitly accepted releasing the P-Trades side after the provider
   * refused removal. The provider-side account may still exist.
   */
  force?: boolean;
}

/**
 * Disconnecting is deliberately conservative: the connection is marked
 * disconnected, the remote account is removed so it cannot keep trading or
 * accruing cost, and everything already recorded stays exactly as recorded.
 *
 * Two cases never touch the provider: a reserved engine account, and a forced
 * release after the provider already refused removal.
 */
export function planDisconnect(input: DisconnectInput): DisconnectPlan {
  if (input.hasRemoteAccount && input.reservedRemote) {
    return {
      removeRemote: false,
      keepsHistory: true,
      summary:
        "P-Trades removed this connection from your profile. The trading account it pointed at is reserved by P-Trades, so nothing was changed at your broker-connection provider. Everything already recorded in P-Trades is kept.",
    };
  }
  if (input.hasRemoteAccount && input.force) {
    return {
      removeRemote: false,
      keepsHistory: true,
      summary:
        "P-Trades released this connection on its side, so the slot is free again. Your broker-connection provider still refused removal, so the account may still exist there and can be removed in your provider console. Everything already recorded in P-Trades is kept.",
    };
  }
  return {
    removeRemote: input.hasRemoteAccount,
    keepsHistory: true,
    summary: input.hasRemoteAccount
      ? "P-Trades will stop this connection and remove it from your broker-connection provider. Your broker account itself is untouched, and everything already recorded in P-Trades is kept."
      : "P-Trades will mark this connection as disconnected. Nothing was ever created at your broker-connection provider for it.",
  };
}


/** Never show a full broker login. */
export function maskLogin(login: string | number | null | undefined): string | null {
  if (login === null || login === undefined) return null;
  const text = String(login).trim();
  if (!text) return null;
  if (text.length <= 4) return `••${text.slice(-2)}`;
  return `••••${text.slice(-4)}`;
}
