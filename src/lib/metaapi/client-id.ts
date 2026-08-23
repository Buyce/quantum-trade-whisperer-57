/**
 * MetaApi `clientId` construction — the PRIMARY ownership key linking a
 * P-Trades order to the broker's own order/deal records.
 *
 * MetaApi constrains `comment` + `clientId` to at most 26 characters and the
 * client id to the pattern
 * `strategyId_positionId_orderId`, where each part matches `[0-9A-Za-z_]*`.
 * A clientId that is truncated or malformed would silently break
 * reconciliation, so this builder fails loudly instead of guessing.
 *
 * Pure: no fetch, no env, no clock.
 */

// Direct orders deliberately omit the optional broker comment, leaving the
// entire documented combined budget to the ownership key.
export const CLIENT_ID_MAX_LENGTH = 26;
const PART_RE = /^[0-9A-Za-z]+$/;

/** P-Trades strategy tag; short on purpose to leave room for the ids. */
export const PTRADES_STRATEGY_ID = "PT";

export class ClientIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientIdError";
  }
}

/** Strip everything MetaApi does not allow inside a clientId part. */
export function sanitiseIdPart(raw: string): string {
  return raw.replace(/[^0-9A-Za-z]/g, "");
}

export interface ClientIdParts {
  strategyId: string;
  /** Our own signal/plan reference (the "position" slot). */
  positionRef: string;
  /** Our own attempt/delivery reference (the "order" slot). */
  orderRef: string;
}

/**
 * Build `strategyId_positionRef_orderRef`.
 *
 * Both refs are sanitised, then the position ref is shortened from the LEFT
 * (keeping its most-random tail) only as far as needed to fit 26 characters.
 * If it cannot fit while keeping both refs distinguishable, we throw.
 */
export function buildClientId(parts: ClientIdParts): string {
  const strategyId = sanitiseIdPart(parts.strategyId);
  const orderRef = sanitiseIdPart(parts.orderRef);
  let positionRef = sanitiseIdPart(parts.positionRef);

  for (const [name, value] of [
    ["strategyId", strategyId],
    ["positionRef", positionRef],
    ["orderRef", orderRef],
  ] as const) {
    if (!PART_RE.test(value)) {
      throw new ClientIdError(`clientId ${name} is empty after sanitisation`);
    }
  }

  const overhead = strategyId.length + orderRef.length + 2; // two underscores
  const room = CLIENT_ID_MAX_LENGTH - overhead;
  if (room < 4) {
    throw new ClientIdError(
      `clientId cannot fit within ${CLIENT_ID_MAX_LENGTH} characters (strategy ${strategyId.length}, order ${orderRef.length})`,
    );
  }
  if (positionRef.length > room) positionRef = positionRef.slice(-room);

  const clientId = `${strategyId}_${positionRef}_${orderRef}`;
  if (clientId.length > CLIENT_ID_MAX_LENGTH) {
    throw new ClientIdError(
      `clientId ${clientId.length} characters exceeds ${CLIENT_ID_MAX_LENGTH}`,
    );
  }
  return clientId;
}

/** TRUE when a broker-reported clientId was produced by this builder's shape. */
export function isPTradesClientId(clientId: string | null | undefined): boolean {
  if (!clientId) return false;
  if (clientId.length > CLIENT_ID_MAX_LENGTH) return false;
  const parts = clientId.split("_");
  if (parts.length !== 3) return false;
  if (parts[0] !== PTRADES_STRATEGY_ID) return false;
  return parts.every((p) => PART_RE.test(p));
}

/** Parse a P-Trades clientId back into its refs, or `null` when foreign. */
export function parseClientId(
  clientId: string | null | undefined,
): { strategyId: string; positionRef: string; orderRef: string } | null {
  if (!isPTradesClientId(clientId)) return null;
  const [strategyId, positionRef, orderRef] = (clientId as string).split("_");
  return { strategyId: strategyId!, positionRef: positionRef!, orderRef: orderRef! };
}
