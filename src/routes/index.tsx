import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import ptradesMark from "@/assets/ptrades-mark.png.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "P-Trades Hub — Forex Scanner, Risk Sizing & Trade Journal" },
      {
        name: "description",
        content:
          "A quantitative Forex terminal: XAUUSD, GBPAUD and EURUSD scanned every 15 minutes across H4/H1/M15, setups graded A+/A/B/C, risk sized to your own settings, and expectancy tracked in R.",
      },
      {
        property: "og:title",
        content: "P-Trades Hub — Forex Scanner, Risk Sizing & Trade Journal",
      },
      {
        property: "og:description",
        content:
          "Graded ABC retracement setups, position sizing against your own risk settings, a trade journal measured in R, and full AI-assistant access over MCP — with an explicit No Trade default.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://getptrades.com/" },
      // `summary` deliberately: the page ships no absolute social image, and a
      // large-image card without an image renders worse than a small one.
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://getptrades.com/" }],
  }),
  component: Landing,
});

/** The three-step user loop the whole terminal is organised around. */
const LOOP = [
  {
    title: "Scan",
    body: "Three instruments, three timeframes, every 15 minutes. Each ABC retracement structure is scored on four confluence pillars and graded A+, A, B or C. The default answer is No Trade — when a scan cycle qualifies nothing, the terminal says so instead of filling the screen.",
  },
  {
    title: "Plan",
    body: "Each surviving structure becomes a fully specified profile: a limit entry, a maximum acceptable entry so you never chase, an ATR-buffered structural stop, structure-capped targets, R:R, a confidence score, and the lot size your own risk settings allow.",
  },
  {
    title: "Measure",
    body: "Log a setup as taken or skipped, add your real fills, and read expectancy in R against an explicit basis. Small samples remain visible as a record, but row/day gates label them immature rather than treating them as evidence.",
  },
] as const;

/** Compact methodology/provenance strip. Each line must be defensible in code. */
const METHOD = [
  {
    k: "Deterministic rules",
    v: "Grading, targets and stops come from fixed, versioned rules — not from a model guessing an outcome. A grade describes structure quality; the confidence score is rule satisfaction, never a win probability.",
  },
  {
    k: "Explicit provenance",
    v: "Every figure is labelled by where it came from: broker candles, engine calculation, deterministic replay, or your own reporting. Margin is shown as an estimate from the contract specification and your leverage, never as a broker quote.",
  },
  {
    k: "No forced trades",
    v: "No global daily quota. Each account sets its own daily setup cap — unlimited by default — and a filtered empty view means only that nothing matches that view.",
  },
  {
    k: "Nothing invented",
    v: "When an input is missing or stale — no equity set, no contract specification, a conversion rate too old to trust — sizing refuses and names the reason instead of guessing.",
  },
  {
    k: "Alerts never carry orders",
    v: "The notification path — web/Android push and email — has no route to a broker: it can only tell you something qualified. Placing an order is a separate system with its own switches, and no alert can turn it on.",
  },
  {
    k: "Execution is opt-in and gated",
    v: "You may connect a MetaTrader account and leave it in Observe, arm automatic orders on a demo account, require per-order confirmation on a real account, or allow automatic real orders. Each step is armed deliberately and passes independent global, account, policy and exposure gates every time; the first send of any bridge is a dry run.",
  },
  {
    k: "Broker evidence stays separate",
    v: "Your own journal, evidence read back from your broker, a controlled benchmark account and research replay are reported as four distinct sources and never merged. Broker figures the account does not report stay marked unavailable — Settings values are never substituted for them.",
  },
  {
    k: "Broker telemetry is monitoring",
    v: "MetaStats history and Risk Guardian drawdown events are observations timestamped by the broker, shown when the account reports them. They describe what happened; they are not a pre-submit safeguard, and no reported breach does not prove no risk.",
  },
  {
    k: "Built for AI assistants",
    v: "Twelve MCP tools let ChatGPT, Claude or Claude Code read your setups, size a position and maintain your journal as you — using the same eligibility rules, sizing service and R mathematics as the screen.",
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

      <main>
        {/* Hero — one claim, one paragraph, two actions. */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
          <p className="label-xs">Autonomous forex market scanner</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-bold leading-[1.1] tracking-tight text-foreground sm:text-6xl">
            A quantitative terminal that also tells you when{" "}
            <span className="text-primary">not</span> to trade.
          </h1>
          <p className="mt-6 max-w-2xl text-base text-muted-foreground">
            P-Trades Hub scans XAUUSD, GBPAUD and EURUSD across H4, H1 and M15, grades the ABC
            retracement structures it finds, turns the survivors into a fully specified trade plan
            sized to your own risk settings — and then measures, in R, what your decisions actually
            earned.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/auth">Sign in to the terminal</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/auth" search={{ mode: "signup" }}>
                Create an account
              </Link>
            </Button>
          </div>

          <dl className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STATS.map((s) => (
              <div key={s.k} className="rounded-md border border-border bg-card p-4">
                <dt className="label-xs">{s.k}</dt>
                <dd className="num mt-2 text-2xl font-semibold text-foreground">{s.v}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Scan · Plan · Measure — the only feature narrative on the page. */}
        <section className="border-t border-border bg-surface/50">
          <div className="mx-auto max-w-6xl px-4 py-16">
            <p className="label-xs">The loop</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
              Scan · Plan · Measure
            </h2>
            <ol className="mt-6 grid gap-4 sm:grid-cols-3">
              {LOOP.map((step, i) => (
                <li key={step.title} className="rounded-md border border-border bg-card p-5">
                  <span className="num text-xs text-primary">0{i + 1}</span>
                  <h3 className="mt-2 text-base font-semibold text-foreground">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Compact methodology / provenance strip — replaces the old feature-card wall. */}
        <section className="border-t border-border">
          <div className="mx-auto max-w-6xl px-4 py-16">
            <p className="label-xs">How it behaves</p>
            <dl className="mt-6 divide-y divide-border border-y border-border">
              {METHOD.map((m) => (
                <div
                  key={m.k}
                  className="grid gap-1 py-4 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-6"
                >
                  <dt className="text-sm font-semibold text-foreground">{m.k}</dt>
                  <dd className="text-sm leading-relaxed text-muted-foreground">{m.v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Final CTA */}
        <section className="border-t border-border bg-surface/50">
          <div className="mx-auto max-w-6xl px-4 py-16">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">
              Open the terminal
            </h2>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
              Set your equity, risk per trade and instruments once. From then on the feed shows only
              what qualified — and an in-app guide explains every figure, including what it does not
              claim.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to="/auth" search={{ mode: "signup" }}>
                  Create an account
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/calculator">Position size calculator</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/connect">Connect an AI assistant</Link>
              </Button>

            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-8 text-xs text-muted-foreground">
          <span>P-Trades Hub · Analytical tool only. Nothing here is financial advice.</span>
          <Link to="/connect" className="text-primary underline underline-offset-2">
            Connect an AI assistant
          </Link>
          <Link to="/calculator" className="text-primary underline underline-offset-2">
            Position size calculator
          </Link>
          <Link to="/auth" className="text-primary underline underline-offset-2">

            Sign in
          </Link>
        </div>
      </footer>
    </div>
  );
}
