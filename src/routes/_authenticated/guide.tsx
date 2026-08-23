import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Search } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { GuideModeToggle } from "@/components/GuideMode";

export const Route = createFileRoute("/_authenticated/guide")({
  head: () => ({
    meta: [
      { title: "Guide — How the P-Trades Hub terminal works" },
      {
        name: "description",
        content:
          "Plain-English explanations of grades, confidence, R, risk sizing, the trade journal, performance statistics and execution safety in P-Trades Hub.",
      },
      { property: "og:title", content: "Guide — How the P-Trades Hub terminal works" },
      {
        property: "og:description",
        content:
          "What each number in the terminal means, where it comes from, and what it does not claim.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      // Authenticated help content: kept out of sitemap.xml and out of indexes.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: GuidePage,
});

/**
 * One question-and-answer entry. `id` is the anchor other screens deep-link to
 * (`/guide#<id>`), so ids are part of the app's internal link contract and must
 * not be renamed casually.
 *
 * `a` carries free-form paragraphs. The four optional fields carry the
 * consistent explanation frame used across the terminal's Guide Mode: what it
 * is, why it matters, what to do, and what not to assume. `example` is always
 * rendered with an explicit "Educational example — not live market data" label,
 * because no illustrative number may ever be mistaken for a published setup.
 */
type Entry = {
  id: string;
  q: string;
  a: string[];
  means?: string;
  matters?: string;
  todo?: string;
  assume?: string;
  example?: string[];
};

type Section = { id: string; title: string; blurb: string; entries: Entry[] };

const SECTIONS: Section[] = [
  {
    id: "getting-started",
    title: "Getting started",
    blurb: "The five minutes of setup that make every other number meaningful.",
    entries: [
      {
        id: "first-steps",
        q: "I just signed in. What should I do first?",
        a: [
          "Open Settings and enter your account equity, account currency, leverage and risk per trade. Until those exist the terminal cannot size a position, and it will refuse rather than guess.",
          "Then choose your instruments, trading sessions and the minimum grade you want to be alerted about, and decide whether you want push, email or both. Finally, come back to the feed: it shows only setups that survived both the engine's rules and your own filters.",
        ],
        means: "Settings are the inputs the whole terminal computes against.",
        matters:
          "Lot size, cash risk, margin estimates and your alert stream are all derived from what you enter here. Nothing is read from your broker.",
        todo: "Set equity, currency, leverage, risk percent, instruments, sessions and minimum grade before you rely on a lot size.",
        assume:
          "Do not assume the app knows your real balance, open positions or broker costs. It knows what you told it.",
      },
      {
        id: "tour",
        q: "What is each screen for?",
        a: [
          "Feed: setups currently published and eligible under your settings, newest first. History: your own trade journal, including trades you skipped. Performance: expectancy and R statistics computed from your journal, behind evidence gates. Settings: risk inputs, filters, alerts, execution controls and the scanner heartbeat. Connect AI: how to attach ChatGPT, Claude or Claude Code to your own data.",
        ],
        means: "Four working surfaces plus one integration page.",
        matters:
          "Feed and Performance answer different questions: what the engine found, and what your decisions actually earned.",
        todo: "Use the scanner heartbeat in Settings whenever you want to know whether the engine is cycling.",
        assume:
          "An empty Feed is not a statement about Performance, and Performance never includes replay or research rows.",
      },
      {
        id: "guide-mode",
        q: "What is Guide Mode?",
        a: [
          "A toggle in the header. With it on, terminal labels gain an inline explanation you can expand: what the figure is, why it matters, what to do with it, and what not to assume — plus a link into the matching section of this page.",
          "It is progressive disclosure only. Nothing is hidden while it is off, and no permanent walls of text appear while it is on.",
        ],
      },
    ],
  },
  {
    id: "reading-a-signal",
    title: "Understanding a signal",
    blurb: "Reading a published setup card field by field.",
    entries: [
      {
        id: "card-anatomy",
        q: "What is every field on a signal card?",
        a: [
          "Instrument and direction: what to trade and which way. Grade: structure quality (A+/A/B/C). Confidence: how completely the engine's rules were satisfied. Entry: the limit price the plan was graded at. Max acceptable entry: the worst fill that still preserves that payoff. Stop: the structural invalidation level plus an ATR buffer. Targets 1–3: structure-capped objectives, where target 3 may be absent. R:R: reward per unit of risk to the first published target. Size: the lot size your own risk settings allow, with a cash risk figure and a margin estimate.",
        ],
        means:
          "One fully specified plan: where to enter, where you are wrong, where you take profit, and how large.",
        matters:
          "The grade, confidence and R:R were all computed at the entry price. Filling elsewhere silently changes the trade you were shown.",
        todo: "Check the max acceptable entry before placing anything, and size from the plan's own stop distance.",
        assume:
          "Do not assume a grade or confidence figure predicts the outcome, and do not treat the margin figure as your broker's requirement.",
      },
      {
        id: "worked-example",
        q: "Can I see a worked example of the maths?",
        a: [
          "Yes — with the numbers below invented purely to show the arithmetic. They are not a setup, not a recommendation, and no such row exists in the feed.",
        ],
        example: [
          "Equity 10,000 USD, risk per trade 1% → 100 USD of risk for this trade.",
          "Entry 1.0850, stop 1.0800 → stop distance 50 pips → 1 R = 50 pips.",
          "At 10 USD per pip per lot, 100 USD / (50 × 10) = 0.20 lots.",
          "First target 1.0950 → 100 pips of reward against 50 pips of risk → R:R 2.0.",
          "If price runs to that target you gain +2R; if the stop is hit you lose −1R. Expectancy is then read across many such trades, never one.",
        ],
        means: "R converts every instrument onto one comparable scale.",
        matters:
          "Sizing from a fixed cash risk, rather than a fixed lot size, is what keeps one bad trade from mattering more than another.",
        todo: "Use the size the terminal computes for the plan you are actually placing.",
        assume:
          "Do not reuse these figures: real pip values, lot steps and stop distances differ per instrument and are computed per setup.",
      },
      {
        id: "empty-view",
        q: "My feed is empty — what does that actually tell me?",
        a: [
          "It tells you that nothing matched this view. Your instruments, sessions, minimum grade, daily cap and the retention window all filter the feed, so an empty screen can simply mean your filters excluded everything that was published.",
          "Only an unfiltered, current-cycle view can support a scanner-wide No Trade reading, and the scanner heartbeat in Settings is the authority on whether the engine is cycling at all. Whatever the cause, the terminal will never invent an example setup to fill the screen.",
        ],
        means: "Zero rows in this view, nothing more.",
        matters:
          "Reading a filtered empty screen as 'the market offered nothing' is how people widen their filters at exactly the wrong moment.",
        todo: "Widen or clear your filters to see everything published, and check the heartbeat for engine health.",
        assume:
          "Do not assume an empty feed means No Trade, and do not assume it means something is broken.",
      },
    ],
  },
  {
    id: "signals",
    title: "Signals and grades",
    blurb: "What the scanner publishes, and how strong a setup actually is.",
    entries: [
      {
        id: "grades",
        q: "What do A+, A, B and C mean?",
        a: [
          "The scanner looks for an ABC retracement: a strong move, then a pull-back into a decision zone called Point C. Each structure is tested against four confluence pillars — trend alignment across H4/H1/M15, whether Point C sits inside an institutional order block, momentum exhaustion, and volatility expansion. A pillar passes at 60 out of 100.",
          "A+ is an A-grade structure with all four pillars passing. A is strong multi-timeframe alignment at Point C. B has H1/M15 alignment but a higher-timeframe obstacle ahead. C is an aggressive M15 mean-reversion break with the higher timeframes disagreeing.",
          "A grade describes structure quality. It is not a forecast.",
        ],
      },
      {
        id: "confidence",
        q: "Is the confidence score a win probability?",
        a: [
          "No. Confidence is a weighted rule-satisfaction score: trend 35%, order block 25%, momentum 20%, volatility expansion 20%, with the payoff ratio applied afterwards as a cap so a beautiful structure with a poor payoff cannot score highly.",
          "It answers 'how many of my rules did this satisfy', not 'how often does this win'. Nothing in the terminal converts it into a probability.",
        ],
      },
      {
        id: "no-trade",
        q: "What does the No Trade default mean?",
        a: [
          "The engine publishes nothing unless a structure passes its rules, so a scan cycle that qualifies nothing produces no rows. Quiet markets, and closed markets at the weekend, genuinely look quiet.",
          "That is a claim about a scan cycle, not about your screen. Your own feed is filtered by instruments, sessions, minimum grade, daily cap and the retention window, so an empty feed only tells you that nothing matched that view — see “My feed is empty” under Understanding a signal. The scanner heartbeat in Settings is the authority on whether the engine is cycling.",
        ],
      },
      {
        id: "data-outage",
        q: "What happens if the market data provider stops serving candles?",
        a: [
          "Scan cycles that cannot fetch candles record a failure and evaluate nothing. Those cycles produce missing results, not empty ones: nothing was judged, so nothing can be concluded about the market. The terminal never substitutes cached, simulated or example candles to cover a gap.",
          "A delayed heartbeat in Settings is the signal for this. If the provider refuses market data outright — for example an account or billing limit at the data vendor — the engine keeps recording the refusal verbatim rather than reporting a quiet market, and a repeated whole-cycle data failure also trips a safety pause on the separate replay/statistics engine so it stops retrying a dead source. Live scanning is not paused by that safety switch; statistics simply stop advancing until data returns.",
        ],
      },



      {
        id: "entry-window",
        q: "Why did a setup disappear, and what is the maximum acceptable entry?",
        a: [
          "A pending order that has not filled is cancelled after 30 minutes — two M15 candles — because after that the market is no longer the one that was graded. Active setups are also swept after 24 hours, and old rows are eventually deleted (A+/A after 48h, B after 36h, C after 24h).",
          "The maximum acceptable entry is a slippage ceiling. Filling worse than that price breaks the payoff the plan was graded on, because your risk grows while your reward shrinks. Past it, skip the trade rather than chase it.",
        ],
      },
      {
        id: "targets",
        q: "Why is the third target sometimes missing?",
        a: [
          "Targets are only published when the structure can actually reach them before the nearest unbroken H4 barrier. If it cannot, the third target is absent and the setup is marked capped. A target that price would have to walk through a wall to reach is not a target.",
        ],
      },
    ],
  },
  {
    id: "risk",
    title: "Risk and position size",
    blurb: "Turning a plan into a lot size you can actually place.",
    entries: [
      {
        id: "sizing",
        q: "How is my lot size calculated?",
        a: [
          "From the stop distance in the plan and the risk settings you entered: account equity, risk per trade, leverage and account currency. Lots are rounded to the instrument's lot step and floored at its minimum.",
          "Your equity, risk percentage and leverage are self-reported. The app cannot read your broker, so it sizes against what you told it.",
        ],
      },
      {
        id: "margin",
        q: "Is the margin figure what my broker will charge?",
        a: [
          "No. It is an estimate from the contract specification and the leverage you entered. Your broker's own margin requirement, commission and swap are not visible to this app.",
        ],
      },
      {
        id: "refusals",
        q: "Why does it refuse to show me a size?",
        a: [
          "Because an input it needs is missing or untrustworthy, and it will not guess. The reason is always shown: no account balance set, no contract specification for the instrument, no fresh conversion rate, an unusable stop distance, a stop closer than your broker's minimum stop distance, a quote too old to size safely, or a contract specification that is out of date.",
          "GBPAUD is quoted in AUD, so a USD account needs a live AUDUSD rate. If that rate is stale, sizing refuses rather than quietly using yesterday's number.",
        ],
      },
      {
        id: "exposure",
        q: "What does the exposure figure describe?",
        a: [
          "Only the trades you logged in this app. It is advisory. A missing journal entry is never treated as proof that you have no open position at your broker.",
        ],
      },
      {
        id: "high-risk",
        q: "Why must I acknowledge risk above 2%?",
        a: [
          "Because it materially changes what one losing trade costs you. The acknowledgement is stored, and it is required identically in the web terminal and through an AI assistant, so it cannot be skipped by using a different client.",
        ],
      },
    ],
  },
  {
    id: "journal",
    title: "The trade journal and R",
    blurb: "Recording what you actually did, in units of risk.",
    entries: [
      {
        id: "what-is-r",
        q: "What is R?",
        a: [
          "R is one unit of risk — the distance from your entry to your stop. A trade that returns twice what it risked is +2R. Measuring in R lets a Gold trade and a EURUSD trade be compared on the same scale.",
        ],
      },
      {
        id: "two-r",
        q: "Why are there two R numbers?",
        a: [
          "Because two different questions are worth answering. R vs plan measures your realised move against the risk the published plan defined — it grades the plan. R vs actual risk measures the same move against the risk you actually took from your real fill to your real stop — it grades your execution.",
          "Both use your actual fill as the anchor; realised movement is never computed from the planned entry. They are different units of account, so the terminal never averages them together. Every statistic states which basis it used.",
        ],
      },
      {
        id: "snapshot",
        q: "What happens when the signal expires after I logged it?",
        a: [
          "Nothing. The plan is snapshotted onto your journal entry the moment you create it, so a later expiry, deletion or change cannot retroactively alter what your trade was measured against.",
        ],
      },
      {
        id: "verified",
        q: "What does 'verified' mean here?",
        a: [
          "It is never used on its own. A price is either self-reported — typed in by you or by your connected assistant — or verified against a named source. Every price write is permanently stamped with its author, so questionable data can be traced rather than trusted blindly.",
        ],
      },
      {
        id: "no-r",
        q: "Why does my trade show no R at all?",
        a: [
          "Because a required input is genuinely missing, and an honest blank beats a plausible number. The reasons are: the trade is still open, its direction could not be established, no actual prices were entered, or the risk distance was zero.",
          "A resolved trade with an entry but no exit is rejected as a data-entry error, and a stop on the wrong side of your fill is rejected as impossible geometry.",
        ],
      },
      {
        id: "costs",
        q: "Where is my commission and swap in the R figure?",
        a: [
          "Costs are money; R is a price distance. They can only be combined when you record what one R was worth in cash for that trade. Without that, the terminal shows gross R and says so, rather than presenting a cost-adjusted figure it could not compute.",
        ],
      },
    ],
  },
  {
    id: "performance",
    title: "Performance and evidence",
    blurb: "What your own numbers can and cannot support.",
    entries: [
      {
        id: "expectancy",
        q: "What is expectancy in R?",
        a: [
          "(win rate x average win in R) − (loss rate x average loss in R). It is the average R this sample of your completed trades produced. Positive means this sample returned more than it lost. It says nothing about your next trade.",
        ],
      },
      {
        id: "evidence",
        q: "Why does it say 'not enough evidence'?",
        a: [
          "Because a maturity gate was not met: fewer than 30 trades in the bucket, or fewer than 10 distinct trading days. A win rate from six trades on one afternoon is noise, and showing it as if it were a finding is how people ruin accounts.",
        ],
      },
      {
        id: "intervals",
        q: "Why resample whole days instead of individual trades?",
        a: [
          "Trades taken on the same day share the same market conditions, so treating them as independent makes intervals look far tighter than they are. The bootstrap resamples whole UTC days, which respects that dependence. It is deterministic: the same data and seed always produce the same interval.",
          "Where many buckets are compared at once, a Benjamini–Hochberg adjustment is applied, because scanning enough buckets will always throw up something that looks significant by chance.",
        ],
      },
      {
        id: "descriptive",
        q: "Are these statistics predictive?",
        a: [
          "No. There is no holdout or out-of-sample validation layer in the app, so everything shown is descriptive of the sample it was computed from. Results below the maturity gates are labelled diagnostic-only.",
        ],
      },
    ],
  },
  {
    id: "research",
    title: "Research and shadow replay",
    blurb: "How the engine grades itself, kept away from your numbers.",
    entries: [
      {
        id: "shadow",
        q: "What is shadow replay?",
        a: [
          "Every published setup is forward-tested against real stored candles under one fixed policy: a single pending order exiting at the first target. No order is ever placed and no money is involved.",
          "It is deliberately pessimistic. When a single M15 candle contains the entry, the stop and the target, M15 data cannot reveal which came first — so the loss is assumed.",
        ],
      },
      {
        id: "candidates",
        q: "Why record structures the scanner rejected?",
        a: [
          "Because measuring only what you published tells you nothing about what your filters cost you. Structures are enrolled before the publish decision, so the rejected group can be forward-tested on the same terms. That comparison is admin-only.",
        ],
      },
      {
        id: "isolation",
        q: "Does research data affect what I see?",
        a: [
          "No. Research and shadow rows never enter the feed, alerts, eligibility, your journal or your personal performance. Your performance page is built from your logged trades and nothing else, and the two are never summed.",
          "Replay results are also not a track record: no order was placed, and spread, commission, swap and slippage beyond the plan's own tolerances are not included.",
        ],
      },
    ],
  },
  {
    id: "execution",
    title: "Alerts, execution and AI access",
    blurb: "What can leave the server, and what cannot.",
    entries: [
      {
        id: "eligibility",
        q: "Why did a setup appear in the feed but not alert me?",
        a: [
          "Feed visibility and alert delivery have separate thresholds. An alert additionally respects your minimum grade, your instrument and session filters, and your daily setup cap — which counts A+/A/B setups ranked by detection time within the UTC day. C-grade never counts, and a cap of 0 means unlimited.",
        ],
      },
      {
        id: "execution-safety",
        q: "Can this app place trades for me?",
        a: [
          "Only if you configure an external bridge and explicitly arm it. Live execution is disabled globally by default, and the scanner's alert path cannot send broker instructions at all — orders only travel through the execution ledger.",
          "Arming live requires a confirmation that names the destination host, the execution policy and the sizing basis. Any change to the settings that determine authorisation or quantity invalidates queued deliveries rather than sending them under new rules.",
        ],
      },
      {
        id: "delivery-states",
        q: "What do dry run, sent, acknowledged and unknown mean?",
        a: [
          "Dry run: the whole validation pipeline ran and nothing left the server. Sent: one request was made — it does not mean the bridge accepted it. Acknowledged: the receiver confirmed, and only this proves acceptance. Unknown: the outcome could not be determined.",
          "Sent and unknown are never retried automatically, because an unacknowledged request may already have created a broker order — and an automatic retry is exactly how a bridge double-fires.",
        ],
      },
      {
        id: "ai",
        q: "What can a connected AI assistant do?",
        a: [
          "Read your signals, scanner and market status, settings, journal and performance; size a position; and log or update trades on your behalf. It uses the same eligibility rules, the same sizing service and the same R mathematics as this screen, so it cannot be told a different number.",
          "It cannot reach your broker, see anyone else's data, enable live execution, alter grading or published signals, or retrieve secrets. Every price it writes is permanently stamped as agent-entered.",
        ],
      },
    ],
  },
];

/** The consistent explanation frame, rendered only for the fields present. */
function Frame({ entry }: { entry: Entry }) {
  const rows: [string, string | undefined][] = [
    ["What it is", entry.means],
    ["Why it matters", entry.matters],
    ["What to do", entry.todo],
    ["What not to assume", entry.assume],
  ];
  const present = rows.filter((r): r is [string, string] => Boolean(r[1]));
  if (present.length === 0) return null;
  return (
    <dl className="grid gap-2 rounded-sm border border-border bg-surface/60 p-3">
      {present.map(([k, v]) => (
        <div key={k} className="grid gap-0.5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
          <dt className="label-xs">{k}</dt>
          <dd className="text-sm leading-relaxed text-muted-foreground">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function GuidePage() {
  const [query, setQuery] = useState("");

  // Filter by heading: section titles and entry questions only. Body text is
  // deliberately excluded so a match always corresponds to a visible heading
  // the reader can scan, rather than a hit buried inside a collapsed answer.
  const needle = query.trim().toLowerCase();
  const sections = needle
    ? SECTIONS.map((s) => {
        const sectionHit = s.title.toLowerCase().includes(needle);
        const entries = sectionHit
          ? s.entries
          : s.entries.filter((e) => e.q.toLowerCase().includes(needle));
        return { ...s, entries };
      }).filter((s) => s.entries.length > 0)
    : SECTIONS;

  const matchCount = sections.reduce((n, s) => n + s.entries.length, 0);

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <p className="label-xs">Guide</p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          How this terminal works
        </h1>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Every number here is either derived from broker candles, computed by the engine from that
          data, produced by deterministic replay, or reported by you — and it is labelled with
          which. Where an input is missing or stale, the terminal refuses and names the reason
          instead of inventing one. This page explains what each figure means, and what it does not
          claim.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Prefer inline explanations while you work?
          </span>
          <GuideModeToggle />
        </div>
      </header>

      <div className="space-y-3">
        <div className="relative max-w-md">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search headings — e.g. margin, R, grade, alert"
            aria-label="Search guide headings"
            className="pl-8"
          />
        </div>
        {needle ? (
          <p aria-live="polite" className="text-xs text-muted-foreground">
            {matchCount === 0
              ? "No heading matches that. Clear the search to browse every section."
              : `${matchCount} matching ${matchCount === 1 ? "topic" : "topics"}.`}
          </p>
        ) : (
          <nav aria-label="Guide sections" className="flex flex-wrap gap-2">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="rounded-sm border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {s.title}
              </a>
            ))}
          </nav>
        )}
      </div>

      <div className="space-y-5">
        {sections.map((section) => (
          <Card key={section.id} id={section.id} className="scroll-mt-32">
            <CardHeader>
              <CardTitle className="text-base">{section.title}</CardTitle>
              <p className="text-xs text-muted-foreground">{section.blurb}</p>
            </CardHeader>
            <CardContent>
              <Accordion type="multiple" className="w-full">
                {section.entries.map((entry) => (
                  <AccordionItem key={entry.id} value={entry.id} id={entry.id}>
                    <AccordionTrigger className="text-left text-sm">{entry.q}</AccordionTrigger>
                    <AccordionContent className="space-y-3">
                      {entry.a.map((p, i) => (
                        <p key={i} className="text-sm leading-relaxed text-muted-foreground">
                          {p}
                        </p>
                      ))}
                      {entry.example ? (
                        <div className="rounded-sm border border-dashed border-border bg-surface/60 p-3">
                          <p className="label-xs text-warning">
                            Educational example — not live market data
                          </p>
                          <ul className="mt-2 space-y-1">
                            {entry.example.map((line, i) => (
                              <li key={i} className="num text-sm text-muted-foreground">
                                {line}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      <Frame entry={entry} />
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Still unclear?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            The repository's <span className="text-foreground">/docs</span> directory documents each
            subsystem in full, including its inputs, failure behaviour and explicit non-guarantees.
          </p>
          <p>
            To let an AI assistant answer questions against your own live data, see{" "}
            <Link to="/connect" className="text-primary underline underline-offset-2">
              Connect AI
            </Link>
            .
          </p>
          <p className="text-xs">
            P-Trades Hub is an analytical tool. Nothing in it is financial advice.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
