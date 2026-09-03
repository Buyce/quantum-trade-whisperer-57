import { fetchCandles, fetchQuote } from "../src/lib/metaapi/market.server";
const syms = ["WTI","WTIB","WTID","WTIP","WTIU","USTEC","USTECH100M"];
for (const s of syms) {
  let last = "err", n = 0, q = "none";
  try { const c: any = await fetchCandles(s, "M15", 20); n = c.length; last = String(c.at(-1)?.time ?? c.at(-1)?.timestamp ?? "?"); } catch (e:any) { last = "ERR " + e.message.slice(0,60); }
  try { const quote: any = await fetchQuote(s); q = quote ? `${quote.bid}/${quote.ask} @ ${quote.time ?? quote.brokerTime ?? "?"}` : "null"; } catch (e:any) { q = "ERR " + e.message.slice(0,60); }
  console.log(s.padEnd(12), n, last, "|", q);
}
