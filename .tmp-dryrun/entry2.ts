import { fetchCandles } from "../src/lib/scanner/metaapi.server";
import { buildTradeProfile } from "../src/lib/scanner/profile";
import { INSTRUMENTS, type Candle, type Timeframe } from "../src/lib/scanner/types";
import { formatWebhookPayload } from "../src/lib/scanner/webhook.server";

const tfs: Timeframe[] = ["H4", "H1", "M15"];
const ms = (t: string) => new Date(t).getTime();

for (const ins of INSTRUMENTS) {
  const full = {} as Record<Timeframe, Candle[]>;
  for (const tf of tfs) full[tf] = await fetchCandles(ins, tf, tf === "M15" ? 1000 : 300);
  let found = 0;
  // Walk backwards through real historical M15 closes until a real structure grades.
  for (let back = 0; back < 400 && found < 2; back += 1) {
    const m15 = full.M15.slice(0, full.M15.length - back);
    const cutoff = ms(m15[m15.length - 1]!.time);
    const candles = {
      H4: full.H4.filter((c) => ms(c.time) <= cutoff),
      H1: full.H1.filter((c) => ms(c.time) <= cutoff),
      M15: m15,
    } as Record<Timeframe, Candle[]>;
    if (candles.H4.length < 50 || candles.H1.length < 50) continue;
    const base = buildTradeProfile({ instrument: ins, candles, session: "tokyo" });
    if (!base) continue;
    const dyn = buildTradeProfile({ instrument: ins, candles, session: "london_new_york_overlap" });
    found += 1;
    const close = m15[m15.length - 1]!.close;
    const row = (label: string, p: NonNullable<typeof base>) => {
      const risk = Math.abs(p.entryPrice - p.stopLoss);
      console.log(
        `| ${ins} @ ${m15[m15.length - 1]!.time} | ${label} | ${p.grade} ${p.direction} | ${close} | ${p.entryPrice} | ${p.stopLoss} | ${(risk / p.atr).toFixed(2)} | ${p.maxR} | ${p.tp1}/${p.tp2}/${p.tp3} | ${p.rrRatio} |`,
      );
    };
    row("tokyo", base);
    if (dyn) {
      row("overlap", dyn);
      console.log("   offset:", /dynamically offset/.test(dyn.qualitativeBreakdown) ? "APPLIED" : "fallback -> Point C",
        "| entry moved:", (dyn.entryPrice - base.entryPrice).toFixed(5));
      console.log("   pineconnector:", formatWebhookPayload(
        { ...dyn, id: "dry-run", detectedAt: new Date().toISOString() } as never, "pineconnector"));
    } else {
      console.log("   overlap: NO TRADE (guards rejected, would fall back — investigate)");
    }
  }
  if (!found) console.log(`${ins}: no qualifying structure in last 400 M15 bars`);
}
