/**
 * Benjamini-Hochberg q-values — DIAGNOSTIC ONLY.
 *
 * BH is applied strictly to an explicitly PREDECLARED, BOUNDED hypothesis family
 * recorded in the experiment ledger. An indefinite rolling family is not a
 * family: passing one is rejected rather than silently accepted, because the
 * denominator would keep changing and every q-value would be meaningless.
 */

export const BH_DIAGNOSTIC_NOTE =
  "Diagnostic only: q-values control the false-discovery rate within one predeclared family.";

export interface Hypothesis {
  /** Stable key predeclared in the experiment ledger. */
  key: string;
  pValue: number;
}

export interface DeclaredFamily {
  familyKey: string;
  /** Every hypothesis key the family will ever contain. Bounded, predeclared. */
  declaredKeys: string[];
  /** Ledger row that declared it. */
  experimentId: string;
}

export interface BHResult {
  key: string;
  pValue: number;
  qValue: number;
  rank: number;
}

export class UndeclaredFamilyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UndeclaredFamilyError";
  }
}

/**
 * Rejects: empty declarations, hypotheses outside the declared set, duplicates,
 * and a declared set smaller than the tested set (a rolling family).
 */
export function benjaminiHochberg(
  family: DeclaredFamily,
  tested: Hypothesis[],
): { familyKey: string; m: number; results: BHResult[]; note: string } {
  if (family.declaredKeys.length === 0) {
    throw new UndeclaredFamilyError(
      `Family "${family.familyKey}" declares no hypothesis keys. BH requires a bounded predeclared family.`,
    );
  }
  const declared = new Set(family.declaredKeys);
  if (declared.size !== family.declaredKeys.length) {
    throw new UndeclaredFamilyError(
      `Family "${family.familyKey}" declares duplicate hypothesis keys.`,
    );
  }
  const seen = new Set<string>();
  for (const h of tested) {
    if (!declared.has(h.key)) {
      throw new UndeclaredFamilyError(
        `Hypothesis "${h.key}" was not predeclared in family "${family.familyKey}".`,
      );
    }
    if (seen.has(h.key)) {
      throw new UndeclaredFamilyError(`Hypothesis "${h.key}" tested twice in one family.`);
    }
    seen.add(h.key);
    if (!Number.isFinite(h.pValue) || h.pValue < 0 || h.pValue > 1) {
      throw new UndeclaredFamilyError(`Hypothesis "${h.key}" has an invalid p-value.`);
    }
  }

  // m is the DECLARED family size, not the number tested this run.
  const m = family.declaredKeys.length;
  const sorted = [...tested].sort((a, b) =>
    a.pValue === b.pValue ? (a.key < b.key ? -1 : 1) : a.pValue - b.pValue,
  );

  const raw = sorted.map((h, i) => ({
    key: h.key,
    pValue: h.pValue,
    rank: i + 1,
    qValue: (h.pValue * m) / (i + 1),
  }));

  // Enforce monotonicity from the largest p downwards.
  let running = 1;
  for (let i = raw.length - 1; i >= 0; i--) {
    running = Math.min(running, raw[i]!.qValue);
    raw[i]!.qValue = Math.min(1, running);
  }

  return { familyKey: family.familyKey, m, results: raw, note: BH_DIAGNOSTIC_NOTE };
}
