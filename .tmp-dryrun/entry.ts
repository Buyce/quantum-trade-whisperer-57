import { fetchCandles } from "../src/lib/scanner/metaapi.server";
import { buildTradeProfile } from "../src/lib/scanner/profile";
import { CANDLE_LIMITS, INSTRUMENTS, type Candle, type Timeframe } from "../src/lib/scanner/types";
import { formatWebhookPayload } from "../src/lib/scanner/webhook.server";

const tfs: Timeframe[] = ["H4", "H1", "M15"];
for (const ins of INSTRUMENTS) {
  const candles = {} as Record<Timeframe, Candle[]>;
  for (const tf of tfs) candles[tf] = await fetchCandles(ins, tf, CANDLE_LIMITS[tf]);
  const close = candles.M15[candles.M15.length - 1]!.close;
  for (const session of ["tokyo", "london_new_york_overlap"]) {
    const p = buildTradeProfile({ instrument: ins, candles, session });
    if (!p) { console.log(`${ins} | ${session} | NO TRADE (grading)`); continue; }
    const risk = Math.abs(p.entryPrice - p.stopLoss);
    console.log(
      `${ins} | ${session} | ${p.grade} ${p.direction} | close ${close} | entry ${p.entryPrice} | SL ${p.stopLoss} | risk ${(risk / p.atr).toFixed(2)} ATR | maxR ${p.maxR} | tp ${p.tp1}/${p.tp2}/${p.tp3} | R:R ${p.rrRatio} | maxAcc ${p.maxAcceptableEntry}`,
    );
    if (session === "london_new_york_overlap") {
      console.log("  dynamic note:", /dynamically offset/.test(p.qualitativeBreakdown) ? "APPLIED" : "fallback to Point C");
    }
  }
}
