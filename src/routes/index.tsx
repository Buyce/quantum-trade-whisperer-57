import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Activity, BarChart3, ShieldCheck, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import ptradesMark from "@/assets/ptrades-mark.png.asset.json";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "P-Trades Hub — Autonomous Forex Scanner & Trade Assistant" },
      {
        name: "description",
        content:
          "A quantitative Forex terminal that scans XAUUSD, GBPAUD and EURUSD across H4, H1 and M15, grades ABC retracement setups A/B/C, and tracks expectancy in R.",
      },
      { property: "og:title", content: "P-Trades Hub — Autonomous Forex Scanner & Trade Assistant" },
      {
        property: "og:description",
        content:
          "Graded ABC retracement setups, confidence-scored trade profiles and R-multiple expectancy analytics in one dark quantitative terminal.",
      },
    ],
  }),
  component: Landing,
});

const FEATURES = [
  {
    icon: Activity,
    title: "Market Scanner Engine",
    body: "XAUUSD, GBPAUD and EURUSD scanned every 15 minutes across H4, H1 and M15. Setups graded A, B or C from the mathematical structure of the ABC retracement.",
  },
  {
    icon: Timer,
    title: "Trade Assistant",
    body: "Defaults to No Trade. Maximum 15 setups a day, each with entry, ATR-buffered stop, 1:1 / 1:2 / 1:3 targets, R:R and a weighted confidence score.",
  },
  {
    icon: BarChart3,
    title: "Performance Engine",
    body: "Expectancy in R, win rate, R distribution, per-instrument and per-grade breakdowns plus a time-of-day heat map generated from your own trade log.",
  },
  {
    icon: ShieldCheck,
    title: "Built for stability",
    body: "Decoupled queue architecture, REST-only market data and hard request timeouts so a stalled instrument never blocks the scan cycle.",
  },
] as const;

function Landing() {
  const navigate = useNavigate();
  // Signed-in visitors never need the marketing page: drop them into the
  // terminal in one step. Client-side only — the server cannot read the
  // browser session, so a beforeLoad gate would loop or break prerender.
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      if (data.user) {
        void navigate({ to: "/feed", replace: true });
        return;
      }
      setChecking(false);
    });
    return () => {
      active = false;
    };
  }, [navigate]);

  if (checking && typeof window !== "undefined") {
    return <div className="min-h-screen bg-background" aria-busy="true" />;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-6xl items-center px-4">
          <div className="flex items-center gap-2">
            <img
              src={ptradesMark.url}
              alt="P-Trades Hub logo"
              width={28}
              height={28}
              className="size-7"
            />
            <span className="num text-sm font-semibold">P-TRADES HUB</span>
          </div>

          <div className="ml-auto">
            <Button asChild size="sm">
              <Link to="/auth">Open terminal</Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 py-20">
        <p className="label-xs">Autonomous forex market scanner</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-bold leading-[1.1] tracking-tight text-foreground sm:text-6xl">
          A quantitative terminal that tells you when <span className="text-primary">not</span> to trade.
        </h1>
        <p className="mt-6 max-w-2xl text-base text-muted-foreground">
          P-Trades Hub scans three instruments across three timeframes, grades every ABC retracement
          structure it finds, and turns the survivors into a fully specified trade profile — entry,
          structural stop, Fibonacci targets, R:R and a weighted confidence score. Then it measures
          what your decisions actually earned, in R.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/auth">Sign in to the terminal</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/auth">Create an account</Link>
          </Button>
        </div>

        <dl className="mt-16 grid gap-4 sm:grid-cols-3">
          {[
            { k: "Instruments monitored", v: "3" },
            { k: "Timeframes per scan", v: "H4 · H1 · M15" },
            { k: "Max setups per day", v: "15" },
          ].map((s) => (
            <div key={s.k} className="rounded-md border border-border bg-card p-4">
              <dt className="label-xs">{s.k}</dt>
              <dd className="num mt-2 text-2xl font-semibold text-foreground">{s.v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="border-t border-border bg-surface/50">
        <div className="mx-auto grid max-w-6xl gap-4 px-4 py-16 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-md border border-border bg-card p-5">
              <f.icon className="size-5 text-primary" />
              <h2 className="mt-3 text-base font-semibold text-foreground">{f.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-4 py-8 text-xs text-muted-foreground">
          P-Trades Hub · Analytical tool only. Nothing here is financial advice.
        </div>
      </footer>
    </div>
  );
}
