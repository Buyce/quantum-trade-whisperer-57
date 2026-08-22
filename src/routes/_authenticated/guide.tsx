import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    ],
  }),
  component: GuidePage,
});

/** One question-and-answer entry. `id` is the anchor other screens link to. */
type Entry = { id: string; q: string; a: string[] };

type Section = { id: string; title: string; blurb: string; entries: Entry[] };

const SECTIONS: Section[] = [
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
        q: "The feed is empty. Is something broken?",
        a: [
          "Almost certainly not. The system defaults to No Trade: if no structure qualifies, nothing is published and the feed shows Capital Preservation Mode Active. Quiet markets, and closed markets at the weekend, look quiet.",
          "The scanner heartbeat in Settings is the authority on whether it is cycling. An empty feed is data, not an outage — and the terminal will never invent an example setup to fill the screen.",
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

function GuidePage() {
  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <p className="label-xs">Guide</p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          How this terminal works
        </h1>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Every number here is either derived from live broker data, computed by the engine from that
          data, or reported by you. Where an input is missing, the terminal refuses and names the
          reason instead of estimating. This page explains what each figure means — and what it does
          not claim.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Prefer inline explanations while you work?
          </span>
          <GuideModeToggle />
        </div>
      </header>

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

      <div className="space-y-5">
        {SECTIONS.map((section) => (
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
            subsystem in full, including its inputs, failure behaviour and explicit
            non-guarantees.
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
