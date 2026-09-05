/**
 * Public position size calculator.
 *
 * Deliberately the same arithmetic the terminal's sizing service uses, but with
 * NO broker data: every input is typed by the visitor, and the page says so.
 * Where the terminal would need a live FX conversion rate it refuses here too,
 * rather than inventing one — the zero-fabrication rule applies to marketing
 * surfaces exactly as it applies to the terminal.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CONTRACT_SPECS } from "@/lib/risk";

const TITLE = "Position Size Calculator — Lot Size & Cash Risk | P-Trades Hub";
const DESCRIPTION =
  "Work out the lot size and cash at risk for a Forex or gold trade from your account equity, risk percentage and stop distance — the same arithmetic the P-Trades terminal uses to size a setup.";

export const Route = createFileRoute("/calculator")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://getptrades.com/calculator" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://getptrades.com/calculator" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: "P-Trades Position Size Calculator",
          url: "https://getptrades.com/calculator",
          applicationCategory: "FinanceApplication",
          operatingSystem: "Any",
          description: DESCRIPTION,
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        }),
      },
    ],
  }),
  component: CalculatorPage,
});

/** Symbols the terminal knows a contract specification for, ordered for humans. */
const SYMBOLS = Object.keys(CONTRACT_SPECS).sort();

/** Price movement one pip represents. Gold and other non-pip markets use price points. */
function unitOf(symbol: string): { size: number; label: string } {
  const spec = CONTRACT_SPECS[symbol];
  if (!spec) return { size: 1, label: "points" };
  if (spec.base === "XAU" || spec.base === "XAG") return { size: 0.01, label: "points (0.01)" };
  if (spec.quote === "JPY") return { size: 0.01, label: "pips (0.01)" };
  return { size: 0.0001, label: "pips (0.0001)" };
}

type Outcome =
  | { ok: true; lots: number; riskCash: number; riskPerLot: number; currency: string }
  | { ok: false; reason: string };

function calculate(
  symbol: string,
  equityText: string,
  riskPercentText: string,
  stopText: string,
): Outcome | null {
  const spec = CONTRACT_SPECS[symbol];
  const equity = Number(equityText);
  const riskPercent = Number(riskPercentText);
  const stopUnits = Number(stopText);
  if (!equityText || !riskPercentText || !stopText) return null;
  if (!spec) return { ok: false, reason: "No contract specification for that instrument." };
  if (!Number.isFinite(equity) || equity <= 0)
    return { ok: false, reason: "Account equity must be a positive number." };
  if (!Number.isFinite(riskPercent) || riskPercent <= 0 || riskPercent > 100)
    return { ok: false, reason: "Risk per trade must be between 0 and 100 percent." };
  if (!Number.isFinite(stopUnits) || stopUnits <= 0)
    return { ok: false, reason: "The stop distance must be greater than zero." };

  const unit = unitOf(symbol);
  const stopPrice = stopUnits * unit.size;
  const riskCash = (equity * riskPercent) / 100;
  const riskPerLot = stopPrice * spec.contractSize;
  if (riskPerLot <= 0) return { ok: false, reason: "That stop distance is too small to size." };

  const rawLots = riskCash / riskPerLot;
  const steps = Math.floor(rawLots / spec.lotStep);
  const lots = Number((steps * spec.lotStep).toFixed(4));
  if (lots < spec.minLot)
    return {
      ok: false,
      reason: `That risk gives less than this instrument's minimum ${spec.minLot} lots. Widen the risk, tighten the stop, or trade a smaller instrument — do not round up.`,
    };

  return { ok: true, lots, riskCash: lots * riskPerLot, riskPerLot, currency: spec.quote };
}

function CalculatorPage() {
  const [symbol, setSymbol] = useState("EURUSD" in CONTRACT_SPECS ? "EURUSD" : (SYMBOLS[0] ?? ""));
  const [equity, setEquity] = useState("10000");
  const [riskPercent, setRiskPercent] = useState("1");
  const [stop, setStop] = useState("25");

  const unit = unitOf(symbol);
  const spec = CONTRACT_SPECS[symbol];
  const result = useMemo(
    () => calculate(symbol, equity, riskPercent, stop),
    [symbol, equity, riskPercent, stop],
  );

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12">
      <p className="label-xs text-muted-foreground">P-Trades Hub</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Position size calculator</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Enter your account equity, the share of it you are willing to lose on one trade, and how far
        away your stop sits. The calculator returns the lot size that risk allows and the cash it
        puts at stake — the same arithmetic the P-Trades terminal runs before it sizes a setup.
      </p>

      <section className="mt-8 space-y-4 rounded-md border border-border bg-card p-5">
        <div>
          <Label className="text-xs" htmlFor="calc-symbol">
            Instrument
          </Label>
          <select
            id="calc-symbol"
            className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
          >
            {SYMBOLS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label className="text-xs" htmlFor="calc-equity">
              Account equity
            </Label>
            <Input
              id="calc-equity"
              type="number"
              inputMode="decimal"
              min={0}
              step="1"
              className="num mt-2"
              value={equity}
              onChange={(e) => setEquity(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs" htmlFor="calc-risk">
              Risk per trade (%)
            </Label>
            <Input
              id="calc-risk"
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step="0.1"
              className="num mt-2"
              value={riskPercent}
              onChange={(e) => setRiskPercent(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs" htmlFor="calc-stop">
              Stop distance in {unit.label}
            </Label>
            <Input
              id="calc-stop"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.1"
              className="num mt-2"
              value={stop}
              onChange={(e) => setStop(e.target.value)}
            />
          </div>
        </div>

        <div className="rounded-md border border-border bg-background p-4" aria-live="polite">
          {result === null ? (
            <p className="text-sm text-muted-foreground">
              Fill in all three fields to see a lot size.
            </p>
          ) : result.ok ? (
            <div className="space-y-2">
              <p className="text-2xl font-semibold num">{result.lots} lots</p>
              <p className="text-sm">
                Cash at risk if the stop is hit:{" "}
                <span className="num font-medium">
                  {result.riskCash.toFixed(2)} {result.currency}
                </span>{" "}
                — {result.riskPerLot.toFixed(2)} {result.currency} per lot over a{" "}
                {Number(stop) || 0} {unit.label.split(" ")[0]} stop.
              </p>
              {spec && spec.quote !== "USD" ? (
                <p className="text-xs text-warning">
                  This result is denominated in {spec.quote}, the currency {symbol} is quoted in. If
                  your account is held in another currency you need that day&apos;s conversion rate
                  to express it — this page will not invent one. The terminal fetches the live rate
                  from your broker and refuses to size when it cannot.
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Rounded down to this instrument&apos;s {spec?.lotStep} lot step. Spread, commission,
                swap and slippage are not included; your broker&apos;s own margin and minimum stop
                rules still apply.
              </p>
            </div>
          ) : (
            <p className="text-sm text-warning">{result.reason}</p>
          )}
        </div>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-medium">How the sizing works</h2>
        <p className="text-sm text-muted-foreground">
          Cash at risk is your equity multiplied by your risk percentage. Risk per lot is the stop
          distance in price multiplied by the instrument&apos;s contract size — 100 troy ounces for
          gold, 100,000 units of the base currency for a standard FX lot. Dividing one by the other
          gives the lot size, then it is rounded <em>down</em> to the broker&apos;s lot step so the
          result never exceeds the risk you typed.
        </p>
        <p className="text-sm text-muted-foreground">
          Inside the terminal the same calculation runs against your connected broker account
          instead of typed numbers: real equity, the broker&apos;s own contract specification and
          minimum stop distance, and a live conversion rate when the instrument is quoted in another
          currency. When any of those is missing or stale, sizing refuses and names the reason
          rather than guessing.
        </p>
      </section>

      <section className="mt-8 rounded-md border border-border bg-card p-5">
        <h2 className="text-lg font-medium">Have this done for you</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          P-Trades Hub scans the market every 15 minutes, grades each setup, and sizes it against
          your own risk settings automatically — with an explicit No Trade default when nothing
          qualifies.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button asChild>
            <Link to="/auth">Create your account</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/">See how the terminal works</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
