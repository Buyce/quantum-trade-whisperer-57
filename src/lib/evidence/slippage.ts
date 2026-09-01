/**
 * Broker slippage: how far the broker's own fill differed from the price
 * P-Trades put its name to.
 *
 * Pure mathematics over recorded facts only. There are exactly two admissible
 * reference prices, in priority order:
 *  1. `published_entry` — the entry price P-Trades published for the setup;
 *  2. `submitted_entry` — the price P-Trades actually sent to the broker.
 *
 * When neither survives (the retention purge deleted the order row behind a
 * recovered trade), slippage is DECLARED UNAVAILABLE. It is never estimated from
 * a signal that no longer exists, and never inferred from the fill alone.
 */

export type SlippageAvailability =
  | "available"
  | "unavailable_no_submitted_record"
  | "unavailable_no_fill"
  | "unavailable_no_direction";

export type SlippageBasis = "published" | "submitted";

export interface SlippageFacts {
  /** The reference price the figure was measured against, or null. */
  publishedEntry: number | null;
  /** Signed so POSITIVE always means the broker filled WORSE than the reference. */
  price: number | null;
  availability: SlippageAvailability;
  basis: SlippageBasis | null;
}

function finite(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function computeSlippage(input: {
  direction: string | null | undefined;
  publishedEntry: number | null | undefined;
  submittedEntry: number | null | undefined;
  fillPrice: number | null | undefined;
}): SlippageFacts {
  const published = finite(input.publishedEntry);
  const submitted = finite(input.submittedEntry);
  const fill = finite(input.fillPrice);
  const reference = published ?? submitted;
  const basis: SlippageBasis | null =
    published !== null ? "published" : submitted !== null ? "submitted" : null;

  if (reference === null || basis === null) {
    return {
      publishedEntry: null,
      price: null,
      availability: "unavailable_no_submitted_record",
      basis: null,
    };
  }
  if (fill === null) {
    return {
      publishedEntry: reference,
      price: null,
      availability: "unavailable_no_fill",
      basis,
    };
  }
  if (input.direction !== "long" && input.direction !== "short") {
    // Without the broker's own direction the sign is unknowable, and an unsigned
    // slippage number would be a guess about who it favoured.
    return {
      publishedEntry: reference,
      price: null,
      availability: "unavailable_no_direction",
      basis,
    };
  }

  const price = input.direction === "long" ? fill - reference : reference - fill;
  return { publishedEntry: reference, price, availability: "available", basis };
}

/** Plain-language reason a slippage figure is missing. */
export function slippageUnavailableCopy(availability: string | null | undefined): string | null {
  switch (availability) {
    case "unavailable_no_submitted_record":
      return "The P-Trades order record for this trade no longer exists, so there is no published price to measure the broker's fill against.";
    case "unavailable_no_fill":
      return "The broker has not reported a fill price for this order yet.";
    case "unavailable_no_direction":
      return "The broker did not report a direction for this trade, so the slippage sign cannot be determined.";
    default:
      return null;
  }
}
