import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Activity,
  BarChart3,
  Bell,
  Bot,
  Brain,
  Clock,
  Crosshair,
  ShieldCheck,
  Smartphone,
  Sliders,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import ptradesMark from "@/assets/ptrades-mark.png.asset.json";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "P-Trades Hub — Forex Scanner, Risk Sizing & Trade Journal" },
      {
        name: "description",
        content:
          "A quantitative Forex terminal: XAUUSD, GBPAUD and EURUSD scanned every 15 minutes across H4/H1/M15, setups graded A+/A/B/C, risk sized to your account, and expectancy tracked in R.",
      },
      { property: "og:title", content: "P-Trades Hub — Forex Scanner, Risk Sizing & Trade Journal" },
      {
        property: "og:description",
        content:
          "A+/A/B/C graded ABC retracement setups, per-account risk sizing, a Bayesian learning engine on shadow-replayed results, and full AI assistant access over MCP.",
      },
    ],
  }),
  component: Landing,
});

const CORE = [
  {
    icon: Activity,
    title: "Market Scanner Engine",
    body: "XAUUSD, GBPAUD and EURUSD scanned every 15 minutes across H4, H1 and M15. Every ABC retracement structure is scored on institutional confluence — 35% trend alignment, 25% order block, 20% momentum, 20% volatility — and graded A+, A, B or C. Identical structures are de-duplicated so the same setup is never re-published.",
  },
  {
    icon: Crosshair,
    title: "Fully specified trade profiles",
    body: "Each setup carries a limit entry with a session-aware offset during the London/New York overlap, a maximum acceptable entry so you never chase, an ATR-buffered structural stop, 1:1 and 1:2 targets plus a third target capped by the nearest unbroken H4 structure, R:R and a confidence score.",
  },
  {
    icon: Sliders,
    title: "Your risk, your rules",
    body: "Set account equity, risk per trade, leverage and a maximum stop-loss distance once. Every signal then shows your lot size, the cash at risk and the margin required — converted for the quote currency, not a generic estimate.",
  },
  {
    icon: BarChart3,
    title: "Performance Engine",
    body: "Expectancy in R, win rate, R distribution, per-instrument and per-grade breakdowns and a time-of-day heat map, generated only from your own logged decisions.",
  },
] as const;

const SYSTEMS = [
  {
    icon: Brain,
    title: "Shadow replay + Bayesian learning",
    body: "Every published setup is forward-tested on real candles with a deterministic triple-barrier replay. A hierarchical Beta-Binomial model then reports fill and win priors per market regime, with per-bucket sample floors and visible gates. Advisory only — it never invents a number it does not have the samples for.",
  },
  {
    icon: ShieldCheck,
    title: "Attributed trade journal",
    body: "Log a setup as taken or skipped, then add your real entry and exit prices so R is recomputed server-side against the plan snapshotted at the time. Prices are self-reported and every write is permanently stamped with its author — you or an AI agent — so questionable data can be traced rather than trusted.",
  },
  {
    icon: Bell,
    title: "Alerts where you are",
    body: "Web and Android push notifications, transactional email briefs, and an optional outbound webhook (raw JSON or PineConnector format) for high-grade setups, with a built-in payload tester.",
  },
  {
    icon: Bot,
    title: "Built for AI assistants",
    body: "Twelve MCP tools plus an agent registration endpoint let ChatGPT, Claude or Codex read live setups, check scanner and session status, change your filters, size risk and maintain your journal on your behalf.",
  },
  {
    icon: Clock,
    title: "Live market hours",
    body: "Sydney, Tokyo, London and New York shown as open, closed or in overlap, with the countdown to the next change and the Friday-to-Sunday weekend close.",
  },
  {
    icon: Smartphone,
    title: "Installable and resilient",
    body: "Installs to an Android home screen as a PWA. Behind it: a decoupled job queue, REST-only market data, hard 8-second fetch timeouts, a self-chaining worker and per-instrument health flags so one stalled feed never blocks a scan cycle.",
  },
] as const;

const STATS = [
  { k: "Instruments monitored", v: "3" },
  { k: "Timeframes per scan", v: "H4 · H1 · M15" },
  { k: "Scan cadence", v: "15 min" },
  { k: "Grade tiers", v: "A+ · A · B · C" },
] as const;

function Landing() {
  const navigate = useNavigate();
  // Signed-in visitors never need the marketing page: drop them into the
  // terminal in one step. Client-side only — the server cannot read the
  // browser session, so a beforeLoad gate would loop or break prerender.
  // Starts false so server HTML and the first client render match exactly.
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (!active || !data.user) return;
        setRedirecting(true);
        void navigate({ to: "/feed", replace: true });
      })
      .catch(() => {
        // Offline or auth unreachable: stay on the public landing page.
      });
    return () => {
      active = false;
    };
  }, [navigate]);

  if (redirecting) {
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
          structure it finds from A+ down to C, and turns the survivors into a fully specified trade
          profile — entry, structural stop, Fibonacci and structure-capped targets, R:R, a weighted
          confidence score and the lot size your own risk settings allow. Then it measures what your
          decisions actually earned, in R.
        </p>
        <p className="mt-4 max-w-2xl text-sm text-muted-foreground">
          Everything shown is derived from live broker data. When there is no valid setup, the feed
          says so — it never fills the screen with examples.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/auth">Sign in to the terminal</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/auth">Create an account</Link>
          </Button>
        </div>

        <dl className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.k} className="rounded-md border border-border bg-card p-4">
              <dt className="label-xs">{s.k}</dt>
              <dd className="num mt-2 text-2xl font-semibold text-foreground">{s.v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">
          No global daily limit. Each account sets its own daily setup cap — unlimited by default.
        </p>
      </section>

      <section className="border-t border-border bg-surface/50">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <p className="label-xs">The engine</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {CORE.map((f) => (
              <div key={f.title} className="rounded-md border border-border bg-card p-5">
                <f.icon className="size-5 text-primary" />
                <h2 className="mt-3 text-base font-semibold text-foreground">{f.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <p className="label-xs">Systems around it</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SYSTEMS.map((f) => (
              <div key={f.title} className="rounded-md border border-border bg-card p-5">
                <f.icon className="size-5 text-primary" />
                <h2 className="mt-3 text-base font-semibold text-foreground">{f.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
                {f.title === "Built for AI assistants" ? (
                  <Link
                    to="/connect"
                    className="mt-3 inline-block text-sm text-primary underline underline-offset-2"
                  >
                    Connection instructions
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-8 text-xs text-muted-foreground">
          <span>P-Trades Hub · Analytical tool only. Nothing here is financial advice.</span>
          <Link to="/connect" className="ml-auto text-primary underline underline-offset-2">
            Connect an AI assistant
          </Link>
        </div>
      </footer>

    </div>
  );
}
