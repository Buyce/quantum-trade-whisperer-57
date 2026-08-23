/**
 * Presentation-only normalization for frozen V1 explanations.
 *
 * V1's raw qualitative string is retained as model output for characterization
 * and historical reproducibility. Some legacy phrases overstate what OHLC
 * heuristics can observe, so every user/agent/export surface passes that string
 * through this function before presenting it. This changes no grade, price,
 * score, replay label or stored historical row.
 */
export function presentSignalBreakdown(raw: string): string {
  return raw
    .replace(/institutional confluence/gi, "four-rule confluence")
    .replace(/unmitigated H1\/H4 institutional zone/gi, "H1/H4 OHLC-derived zone")
    .replace(/nearest institutional zone/gi, "nearest OHLC-derived zone")
    .replace(/institutional order block/gi, "OHLC-derived supply/demand zone")
    .replace(/unmitigated H1\/H4 order block/gi, "H1/H4 OHLC-derived zone")
    .replace(/Point C structural liquidity zone/gi, "recent-range Point-C test zone")
    .replace(/Point C liquidity zone/gi, "recent-range Point-C test zone")
    .replace(
      /Highest-conviction tier: full 1:3 extension with trailing management is justified\./gi,
      "Highest rule-match tier: V1 produces a 1:3 extension; this is not performance validation or execution advice.",
    )
    .replace(
      /Full 1:3 extension is on the table\./gi,
      "V1 produces a 1:3 extension under its geometry; this is not a forecast.",
    )
    .replace(
      /Entry is dynamically offset: the ([^ ]+) momentum regime rarely retests the structural Point C \(([^)]+)\), so the limit sits/gi,
      "Entry uses V1's unvalidated $1 session offset from structural Point C ($2), so the limit sits",
    );
}
