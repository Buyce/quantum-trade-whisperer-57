/**
 * Chronology check for broker trade evidence.
 *
 * Raw broker times are never changed here. This only classifies whether the
 * stored event order is physically possible, so learning can exclude rows
 * whose timestamps cannot be trusted for decision-time reconstruction.
 *
 * Validated rule (ticket 49064728, Peter Live): MetaApi returned the opening
 * deal `time` 10:36:07Z and `brokerTime` 11:36:07 while P-Trades submitted at
 * 11:36:06Z and MetaApi server-time matched our clock to 12ms. The opening
 * deal's own timestamp is one whole hour behind its submission — a broker-side
 * stamp, not our normalisation. A whole-hour gap is reported, never applied.
 */
export type ChronologyStatus = "validated" | "suspect" | "unknown";

export interface ChronologyInput {
  detectedAt?: string | null;
  submittedAt?: string | null;
  entryAt?: string | null;
  exitAt?: string | null;
}

export interface ChronologyResult {
  status: ChronologyStatus;
  reasons: string[];
  /** Whole hours the entry precedes submission, when within tolerance of an exact hour. */
  entryHourOffset: number | null;
}

/** Fill latency allowed before an entry counts as "before submission". */
export const ENTRY_BEFORE_SUBMIT_TOLERANCE_MS = 5_000;
const HOUR = 3_600_000;
const WHOLE_HOUR_TOLERANCE_MS = 60_000;

const ms = (v?: string | null) => (v ? Date.parse(v) : Number.NaN);

export function assessChronology(input: ChronologyInput): ChronologyResult {
  const detected = ms(input.detectedAt);
  const submitted = ms(input.submittedAt);
  const entry = ms(input.entryAt);
  const exit = ms(input.exitAt);
  const reasons: string[] = [];
  let entryHourOffset: number | null = null;

  if (!Number.isFinite(entry) || !Number.isFinite(submitted)) {
    return { status: "unknown", reasons: ["entry or submission time missing"], entryHourOffset };
  }
  if (entry < submitted - ENTRY_BEFORE_SUBMIT_TOLERANCE_MS) {
    reasons.push("entry precedes order submission");
    const gap = submitted - entry;
    const hours = Math.round(gap / HOUR);
    if (hours >= 1 && hours <= 3 && Math.abs(gap - hours * HOUR) <= WHOLE_HOUR_TOLERANCE_MS) {
      entryHourOffset = hours;
    }
  }
  if (Number.isFinite(detected) && submitted < detected) reasons.push("submission precedes setup detection");
  if (Number.isFinite(exit) && exit < entry) reasons.push("exit precedes entry");

  return { status: reasons.length ? "suspect" : "validated", reasons, entryHourOffset };
}
