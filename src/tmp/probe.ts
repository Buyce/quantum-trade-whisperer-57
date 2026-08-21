import { detectAbcV2 } from "../lib/scanner/v2/pointc";
import { m15Series } from "../test/fixtures/provenance";

function series(dir: "long"|"short", retrace: number) {
  const legs: {open:number;high:number;low:number;close:number}[] = [];
  const push = (c: number, w = 0.05) => legs.push({ open: c, high: c + w, low: c - w, close: c });
  const s = dir === "long" ? 1 : -1;
  let px = 100;
  for (let i = 0; i < 200; i++) { px += s * 0.05; push(px); }
  // dip: creates the A pivot
  for (let i = 0; i < 6; i++) { px -= s * 0.5; push(px); }
  const a = px - s * 0.05;
  for (let i = 0; i < 12; i++) { px += s * 1.0; push(px); }
  const b = px + s * 0.05;
  const amp = Math.abs(b - a);
  const cTarget = b - s * amp * retrace;
  for (let i = 1; i <= 6; i++) push(b + ((cTarget - b) * i) / 6);
  // trailing bars so C's bar isn't needed as pivot
  return m15Series("2026-08-01T00:00:00.000Z", legs);
}
for (const r of [0.1, 0.5, 0.6, 0.99]) {
  for (const d of ["long","short"] as const) {
    const abc = detectAbcV2(series(d, r), d);
    console.log(d, r, abc ? abc.retracement.toFixed(3) : null);
  }
}
