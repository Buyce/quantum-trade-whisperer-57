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
          "Plain-English explanations of MetaTrader connections, provenance, grades, risk sizing, performance evidence and execution safety in P-Trades Hub.",
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
          "Manual lot size, cash risk and margin estimates are derived from what you enter here. A connected MetaTrader account is separate: its account facts, execution limits and evidence come from the broker and are labelled as such.",
        todo: "Set equity, currency, leverage, risk percent, instruments, sessions and minimum grade before you rely on a lot size.",
        assume:
          "Do not treat Settings equity as broker-confirmed. Broker facts exist only for a connected, ready account and remain unavailable whenever the broker has not supplied them.",
      },
      {
        id: "tour",
        q: "What is each screen for?",
        a: [
          "Feed: published setups eligible under your settings. Broker Accounts: connect MetaTrader, inspect broker-reported facts and choose observe or an available execution mode. History: your self-reported journal; skipped decisions do not appear there. Performance: three separate sources — My Journal, Broker Account and P-Trades Benchmark. Settings: manual risk inputs, filters, alerts, execution controls and scanner heartbeat. Connect AI: attach an assistant to the currently exposed P-Trades tools.",
        ],
        means: "Four working surfaces plus one integration page.",
        matters:
          "Feed and Performance answer different questions: what the engine found, and what your decisions actually earned.",
        todo: "Use the scanner heartbeat in Settings whenever you want to know whether the engine is cycling.",
        assume:
          "An empty Feed is not a statement about Performance. Performance sources never fall back to one another, and replay/research rows never masquerade as broker evidence.",
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
    id: "connect-metatrader",
    title: "Connect MetaTrader",
    blurb:
      "Progressive steps from an isolated connection to broker evidence and optional execution.",
    entries: [
      {
        id: "connect-account",
        q: "How do I connect a MetaTrader account?",
        a: [
          "Open Broker Accounts, choose Demo or Live as your onboarding intent, select MT4 or MT5, enter the exact broker server name and give the connection a label. P-Trades then opens the provider's secure configuration page in a new tab. Enter the MetaTrader login there; P-Trades does not receive or store the password.",
          "Return to Broker Accounts and press Refresh. The account becomes Ready only after the broker reports its account type and connection facts. If the broker contradicts your Demo/Live intent, P-Trades stops instead of arming the account.",
        ],
        means: "A broker-reported connection, separate from your Settings risk profile.",
        matters:
          "The broker's classification, equity, symbol names, volume limits and trading permissions are authoritative for direct execution.",
        todo: "Start in Observe, verify the masked login, server, account type and symbols, then choose an execution mode only if it is offered.",
        assume:
          "Your onboarding Demo/Live choice is intent, not evidence. Only the broker-reported account type is authoritative.",
      },
      {
        id: "account-modes",
        q: "What do Observe, Demo auto and Live modes permit?",
        a: [
          "Observe reads broker facts and places no orders. Demo auto can place orders only on a broker-confirmed demo account after the account is explicitly armed and the system-wide demo gate is enabled. Live on confirmation and Live auto are available only to broker-confirmed real accounts and remain blocked while their independent global live gates are off.",
          "Every direct order still passes freshness, symbol, account-readiness, exposure, broker specification, volume and price checks. Missing broker data is a refusal, never a guessed replacement.",
        ],
        assume:
          "A Ready connection is not the same as an armed account, and an armed account is not enough when the matching system-wide gate is off.",
      },
      {
        id: "c-grade-automatic-orders",
        q: "Can C-Grade setups become automatic orders?",
        a: [
          "Only if you switch it on yourself. “Allow C-Grade automatic orders” in Rules, alerts & automatic orders is off by default, and while it is off a C-Grade setup can alert you but is never sent to an armed account.",
          "Switching it on authorises nothing on its own. Your alert tier must already include C, and a C-Grade order still passes your instruments, sessions, risk per trade, lot ceiling, exposure limit, the intelligence gate if you use it, and the pre-send broker re-check. C-Grade still never consumes your daily setup cap, so that tier is bounded by those rules rather than by the cap.",
        ],
        assume:
          "C-Grade is the lowest-confluence tier: an opted-in C-Grade order is your explicit choice, recorded in the automatic-order decision log.",
      },
      {
        id: "broker-performance",
        q: "Where do connected-account results appear?",
        a: [
          "Closed deals that can be positively associated with P-Trades' own client reference appear under Broker Account as CUSTOMER BROKER EVIDENCE. Manual broker trades and other EAs are excluded. The dedicated operator demo account appears separately as CONTROLLED BENCHMARK. Prices typed into the journal remain SELF-REPORTED JOURNAL.",
          "Each source has an explicit R vs plan / R vs actual risk selector. The two R bases and the three populations are never combined or silently substituted.",
        ],
      },
      {
        id: "research-consent",
        q: "What does optional pooled research consent do?",
        a: [
          "Consent is off by default on every connected customer account. If you explicitly enable the current consent version, future positively associated broker evidence may enter grouped research under a random pseudonymous reference. Broker login, MetaApi account id, user id and identity do not enter the research surface.",
          "Withdrawal stops future pooling immediately. Evidence already collected under valid consent remains part of the historical population so results are not silently rewritten. Consent never changes signals, orders, journal rows or the three Performance sources.",
        ],
      },
      {
        id: "disconnect-account",
        q: "What happens when I disconnect?",
        a: [
          "P-Trades removes the connection from the provider and stops future observation and execution through it. The broker account itself is untouched. Existing journal, delivery and evidence records are retained with their original provenance.",
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
          "The active V1 scanner uses a deterministic OHLC heuristic called ABC: A and B are swing points, while C is the lowest/highest extreme in the latest six M15 candles. V1 does not enforce a canonical retracement band or full A→B→C chronology. Corrected V2/V3 geometry exists only in isolated research and is not the published engine.",
          "Its four rule pillars are trend alignment, proximity to an OHLC-derived supply/demand-zone heuristic, momentum and volatility expansion. They do not measure institutional orders or order flow. A+ is an A with all four pillars passing; A requires H4/H1/M15 alignment plus the separate timeframe Point-C test; B is any remaining H1/M15 alignment; C is any remaining non-neutral M15 read, not a validated mean-reversion setup.",
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
          "In active V1, target reach is capped by the high or low of the recent 60-bar H4 range. The grade's headroom test uses a different unbroken-swing measure, so the two are not one canonical barrier. If V1's range-extreme maxR is below 3, targets are compressed and TP3 may be absent. V2/V3 unify the barrier, but remain research-only.",
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
          "For manual guidance, equity, risk percentage and leverage remain self-reported Settings inputs. For a direct connected-account delivery, the execution service separately sizes from fresh broker-reported equity and that account's broker specification. It refuses if either is unavailable; it never copies broker equity into Settings.",
        ],
      },
      {
        id: "margin",
        q: "Is the margin figure what my broker will charge?",
        a: [
          "The margin shown beside manual sizing is an estimate from the contract specification and the leverage you entered; it is not a broker promise. A connected account can report free margin and account facts, while commission and swap are recorded from associated broker evidence when the broker supplies them. Missing costs stay missing.",
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
          "The journal exposure figure describes only trades you logged in this app and remains advisory. A connected account has a separate owner-configured account boundary checked against broker-reported open positions and pending orders at submission time. The two are never presented as the same measurement.",
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
          "(win rate x average win in R) − (loss rate x average loss in R). It is the average R produced by the currently selected source and R basis. Positive means that sample returned more than it lost. It says nothing about your next trade.",
          "My Journal is SELF-REPORTED JOURNAL, Broker Account is CUSTOMER BROKER EVIDENCE, and P-Trades Benchmark is CONTROLLED BENCHMARK from the dedicated demo policy. They are never pooled, and scanner replay is not used as a fallback.",
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
          "Published setups are forward-tested against real stored candles. The frozen production Replay V1 uses the historical legacy_best_target_touched policy; corrected research Replay V2 uses a single pending order exiting at TP1. Every result names its replay version and policy. No order is placed and no money is involved.",
          "Replay V1 is retained for historical comparability and has known optimistic defects, including deepest-target credit and fill-before-TIF ordering. Replay V2 checks TIF first, uses actual fill-to-stop risk and resolves unknowable same-bar stop/target order conservatively. Neither is a live track record or a forecast.",
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
          "No. Research and shadow rows never enter the feed, alerts, eligibility, journal or any broker-evidence Performance source. The Performance page keeps self-reported journal, customer broker evidence and controlled benchmark evidence separate, and never sums them.",
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
          "Only through an explicitly configured destination and the execution ledger. A connected MetaTrader account starts in Observe. Demo auto requires a broker-confirmed demo account, explicit account arming and the independent system-wide demo gate. Live execution remains disabled globally by default and requires its own real-account and global gates.",
          "The alert path cannot send broker instructions. Any change to settings that determine authorisation or quantity invalidates queued deliveries rather than sending them under new rules, and an unavailable broker fact fails closed.",
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
          "The current assistant toolset cannot read connected-account details or send broker orders. It also cannot see anyone else's data, enable live execution, alter grading or published signals, or retrieve secrets. Every journal price it writes is permanently stamped as agent-entered.",
        ],
      },
    ],
  },
  {
    id: "safety-limits",
    title: "Automatic safety limits",
    blurb:
      "The Settings controls that can only ever refuse an automatic order — never authorise one.",
    entries: [
      {
        id: "order-ceilings",
        q: "What do the concurrent, daily and per-instrument order limits do?",
        a: [
          "Three separate ceilings bound automatic orders. The concurrent limit caps how many are unresolved at the same time and falls again as orders resolve. The daily limit caps how many were created in the current UTC day and does not fall when an order closes. The per-instrument limit caps how many one instrument may consume inside that daily figure, so a single busy market cannot spend the whole day.",
          "Dry-run rows reach no broker and spend none of the three. If a count cannot be read, orders are refused rather than allowed through.",
        ],
        means: "Upper bounds on automatic order volume.",
        matters:
          "They limit how much can go wrong in one day while a configuration is still being trusted.",
        todo: "Set each to the smallest number that still lets your plan run.",
        assume:
          "A ceiling is never a quota. Being below one is not a reason to place an order, and your broker's own pending-order and margin limits still apply on top.",
      },
      {
        id: "order-rules-together",
        q: "Do the submission ceilings, the freshness-adaptive limits and immediate market entry conflict?",
        a: [
          "No. They answer three different questions, in order. The daily, per-instrument and concurrent limits — optionally moved between your own floor and your own maximum by how fresh the broker equity and price behind sizing are — decide HOW MANY automatic orders may exist. Immediate market entry decides HOW an already-approved order goes in: at market on its first dispatch, or resting at a planned limit. The spread, slippage and total-exposure ceilings decide WHETHER this particular order's price and exposure are acceptable, using your broker's own quote and specification just before it is sent.",
          "They chain rather than compete: whichever rule refuses first wins, and none of them can widen a safety gate. The one interaction worth knowing is that with immediate market entry on, your spread and slippage ceilings are what keep that entry honest. Left at 0 they are off, and the entry is then bounded only by the setup's published maximum acceptable entry.",
        ],
        means: "How many, how it enters, and at what price quality — three layers, one order.",
        matters:
          "Read as competing switches they look contradictory; read in order they describe a single decision path.",
        todo: "Set the counts first, then decide the entry style, then set the price ceilings that bound it.",
        assume:
          "Freshness describes our data, not the market, and it never changes an order's price, size or stop. A ceiling that cannot be measured refuses rather than passing.",
      },
      {
        id: "order-window",
        q: "Why did an automatic order stop being placed after a while?",
        a: [
          "The automatic order window sets how long after detection a setup may still be sent. Past that age the setup is no longer acted on automatically, because the market that produced it has moved on. A resting order that was already placed is labelled as resting at the broker and not as filled.",
        ],
        means: "A freshness limit on automatic orders.",
        matters: "It stops stale setups being executed at prices they were never measured at.",
        todo: "Shorten the window if you want only immediate reactions.",
        assume: "An expired window is not a judgement that the setup was wrong.",
      },
      {
        id: "drawdown-brakes",
        q: "What are the loss limits, and when do they pause trading?",
        a: [
          "Four optional limits, each switched off at zero: daily realised loss, weekly realised loss, consecutive losing trades, and drawdown from your highest observed equity. Only closed, settled broker trades count — an open position and a journal entry both count for nothing, and an exactly break-even close ends a losing run without counting as a loss.",
          "When one is reached, new automatic orders stop. Daily and consecutive-loss pauses lift at the next UTC day; the weekly one at Monday; the equity-drawdown one only when you act. If your closed trades or your broker equity cannot be read, automatic orders are held rather than allowed.",
        ],
        means: "Your own stated loss limits, measured from broker facts.",
        matters:
          "It is the one control that stops a bad run continuing automatically while you are away.",
        todo: "Set limits you would actually honour by hand, then leave them alone.",
        assume:
          "A pause never touches anything already resting or filled at your broker — closing a live position stays your decision. A brake that has not fired is not evidence that risk is absent; an account that cannot be measured is held, not approved.",
      },
      {
        id: "quality-cooldowns",
        q: "What is an execution cooldown?",
        a: [
          "Each combination of account, instrument and trading session is scored on how it recently filled — median slippage and rejection rate over the last 14 days — against its own earlier 60-day record. It is never compared with a different instrument, a different account or a fixed number.",
          "If recent slippage is more than double its own earlier level, or the rejection rate rises by 15 points or more, that combination is paused for 24 hours and then tested again. Below the minimum sample sizes it reads as not measured and pauses nothing.",
        ],
        means:
          "A pause on one account, instrument and session that recently filled unusually badly.",
        matters:
          "A setup being good and your broker filling it well are two different things, and only the second is measurable here.",
        todo: "Read a cooldown as information about your broker conditions, not about the strategy.",
        assume:
          "Not measured does not mean healthy and does not mean zero. A cooldown is an operator-chosen comparison rule, not a statistical test, and says nothing about the instrument in general or about your other accounts.",
      },
      {
        id: "overrides",
        q: "What do the market-entry and unmeasured-intelligence overrides change?",
        a: [
          "Both widen what may be attempted, and both are yours to switch on deliberately. The market-entry override allows an immediate market order where the engine would otherwise wait for its measured price. The unmeasured-intelligence override allows an order to proceed when a supporting measurement is unavailable rather than refusing on the missing input.",
        ],
        means: "Deliberate relaxations of a refusal.",
        matters: "Each one removes a check that exists because a number was missing or worse.",
        todo: "Leave both off unless you have a specific reason and are watching the result.",
        assume:
          "An override never creates evidence. It only permits an action the engine could not justify from what it had measured.",
      },
      {
        id: "adaptive-ceiling",
        q: "What is the adaptive spread ceiling?",
        a: [
          "Instead of one fixed maximum spread, the engine compares the current spread against that instrument's own recorded 21-day pattern, within the floor and maximum you set. When conditions are unusually wide for that instrument, entry tightens; when they are normal, it does not.",
        ],
        means: "A per-instrument spread limit derived from that instrument's own history.",
        matters: "One fixed number is either too loose for gold or too tight for a major pair.",
        todo: "Set the floor and maximum as the bounds you never want crossed either way.",
        assume: "It is a cost filter, not a forecast of the next move.",
      },
      {
        id: "webhook-and-sender",
        q: "What are the webhook destination and sender-domain settings for?",
        a: [
          "The webhook destination is the single address automatic instructions may be sent to; requests are signed so your receiver can verify they came from P-Trades, and addresses on private networks are refused. Nothing is ever sent to an address you have not configured.",
          "The sender-domain records are the DNS entries that let email arrive from notify.getptrades.com rather than a generic address. Until they verify, email alerts may be filtered by your provider.",
        ],
        means: "Where instructions and emails are allowed to go.",
        matters:
          "Alerts and instructions travel on separate paths; the alert path can never carry a broker instruction.",
        todo: "Send the test webhook after any change, and check the sender records show verified.",
        assume:
          "A successful send is not an acceptance. Only an acknowledgement from your receiver proves that.",
      },
      {
        id: "broker-telemetry",
        q: "What do the broker statistics and drawdown tracker panels tell me?",
        a: [
          "They report what your broker says about your account: equity, balance, closed-trade history and the peak-to-current drawdown computed from it. They are the same figures the loss limits are measured against, which is why both are labelled as broker-derived.",
          "Anything the broker has not supplied is shown as unavailable. No figure is substituted from your Settings equity or from your journal.",
        ],
        means: "Broker-reported account facts and the drawdown derived from them.",
        matters: "They are the only account numbers that can gate an automatic order.",
        todo: "Refresh the account if a figure reads unavailable and you expect it to exist.",
        assume:
          "They are not a performance claim about the engine, and they never mix with your self-reported journal.",
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
