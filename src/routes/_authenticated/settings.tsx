import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ACCOUNT_CURRENCIES, money } from "@/lib/risk";
import { Copy, RefreshCw, Save, Send } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { runScanNow, type ManualScanResult } from "@/lib/scanner/scan.functions";
import { sendTestWebhook } from "@/lib/webhook-test.functions";
import { getExecutionStatus, saveBridgeSettings } from "@/lib/execution.functions";

import { useAuth } from "@/hooks/useAuth";
import { saveSettings, settingsQuery } from "@/lib/queries";
import { ALL_INSTRUMENTS, ALL_SESSIONS, ALL_TIMEFRAMES, SESSION_LABELS, INSTRUMENT_LABELS, ORDER_TIF_MINUTES, type Grade, type OrderStrategy, type WebhookFormat } from "@/lib/db-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { FeedbackSection } from "@/components/FeedbackSection";
import { DangerZoneSection } from "@/components/DangerZoneSection";
import { PushSection } from "@/components/PushSection";
import { AgentConnectCard } from "@/components/AgentConnectCard";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — P-Trades Hub" },
      {
        name: "description",
        content: "Configure instruments, timeframes, grade filters, notification delivery and the notify.getptrades.com sender domain.",
      },
      { property: "og:title", content: "Settings — P-Trades Hub" },
      { property: "og:description", content: "Scanner filters, alerts and sender-domain configuration." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SettingsPage,
});

const DNS_RECORDS = [
  { type: "NS", name: "notify", value: "ns3.lovable.cloud" },
  { type: "NS", name: "notify", value: "ns4.lovable.cloud" },
];

/** Display-only host extraction for the live-execution confirmation copy. */
function hostOf(raw: string): string {
  try {
    return new URL(raw.trim()).hostname;
  } catch {
    return "";
  }
}

function SettingsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const settings = useQuery(settingsQuery(user?.id));

  const [instruments, setInstruments] = useState<string[]>([...ALL_INSTRUMENTS]);
  const [timeframes, setTimeframes] = useState<string[]>([...ALL_TIMEFRAMES]);
  const [sessions, setSessions] = useState<string[]>([...ALL_SESSIONS]);
  const [minGrade, setMinGrade] = useState<Grade>("C");
  const [alertMinGrade, setAlertMinGrade] = useState<Grade>("B");
  const [cap, setCap] = useState(50);
  const [push, setPush] = useState(true);
  const [email, setEmail] = useState(false);
  const [orderStrategy, setOrderStrategy] = useState<OrderStrategy>("smart_adaptive");
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [webhookFormat, setWebhookFormat] = useState<WebhookFormat>("json");
  // Automated execution. Off by default, dry-run by default: the safe posture is
  // the one you get without touching anything.
  const [executionEnabled, setExecutionEnabled] = useState(false);
  const [executionDryRun, setExecutionDryRun] = useState(true);
  // Dedicated live-execution confirmation. Never persisted as "sticky intent":
  // it must be given again whenever the execution configuration changes.
  const [confirmLive, setConfirmLive] = useState(false);
  const [exposureLimitEnabled, setExposureLimitEnabled] = useState(false);

  // Risk profile. Held as strings so a half-typed number never becomes NaN or
  // snaps back to a default while the field has focus.
  const [equity, setEquity] = useState("0");
  const [currency, setCurrency] = useState("USD");
  const [riskPercent, setRiskPercent] = useState("1");
  // Persisted high-risk acknowledgement + entered-balance provenance.
  const [riskAckHigh, setRiskAckHigh] = useState(false);
  const [equityAsOf, setEquityAsOf] = useState<string | null>(null);
  const [maxLots, setMaxLots] = useState("0");
  const [leverage, setLeverage] = useState("100");
  const [maxStopPercent, setMaxStopPercent] = useState("0");
  const [saving, setSaving] = useState(false);
  const triggerScan = useServerFn(runScanNow);
  const [scanning, setScanning] = useState(false);
  const [scanReport, setScanReport] = useState<ManualScanResult | null>(null);
  const triggerTestWebhook = useServerFn(sendTestWebhook);
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [testPreview, setTestPreview] = useState<string | null>(null);

  const savedWebhookUrl = settings.data?.webhook_url?.trim() ?? "";
  const savedWebhookSecret = settings.data?.webhook_secret?.trim() ?? "";
  const canTestWebhook = /^https:\/\//i.test(savedWebhookUrl) && savedWebhookSecret.length > 0;
  const savedValidatedAt =
    (settings.data as { webhook_validated_at?: string | null } | undefined)?.webhook_validated_at ??
    null;

  const persistBridge = useServerFn(saveBridgeSettings);
  const executionStatus = useQuery({
    queryKey: ["execution-status"],
    queryFn: () => getExecutionStatus(),
    staleTime: 60_000,
  });
  // Owner-only read: RLS scopes the ledger to the signed-in user, and endpoint
  // URLs are never exposed here — only the host we actually posted to.
  const deliveries = useQuery({
    queryKey: ["execution-deliveries", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data } = await supabase
        .from("execution_deliveries")
        .select("id, state, reason, dry_run, endpoint_host, http_status, enqueued_at")
        .order("enqueued_at", { ascending: false })
        .limit(8);
      return (data ?? []) as Array<{
        id: number;
        state: string;
        reason: string | null;
        dry_run: boolean;
        endpoint_host: string | null;
        http_status: number | null;
        enqueued_at: string;
      }>;
    },
  });

  async function onSendTestWebhook() {
    setTestingWebhook(true);
    try {
      const res = await triggerTestWebhook();
      setTestPreview(res.preview ?? null);
      if (res.ok && res.posted === false) toast.info(res.note ?? "Local preview only — nothing was sent.");
      else if (res.ok) toast.success(`Test request delivered (${res.status} OK)`);
      else toast.error(res.error ?? "The test request failed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The test webhook could not be sent");
    } finally {
      setTestingWebhook(false);
    }
  }

  async function onRunScanNow() {
    setScanning(true);
    setScanReport(null);
    try {
      const result = await triggerScan({ data: undefined });
      setScanReport(result);
      const failed = result.processed.filter((p) => p.status === "failed").length;
      if (failed > 0) toast.error(`Scan finished with ${failed} failed job(s)`);
      else toast.success(`Scan cycle complete — ${result.processed.length} instrument(s) processed`);
      await queryClient.invalidateQueries({ queryKey: ["instrument-health"] });
      await queryClient.invalidateQueries({ queryKey: ["signals"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not run the scan");
    } finally {
      setScanning(false);
    }
  }


  useEffect(() => {
    const s = settings.data;
    if (!s) return;
    setInstruments(s.instruments);
    setTimeframes(s.timeframes);
    setSessions(s.sessions);
    setMinGrade(s.min_grade);
    setAlertMinGrade(s.alert_min_grade ?? "B");
    setCap(s.daily_setup_cap);
    setPush(s.notify_push);
    setEmail(s.notify_email);
    setOrderStrategy(s.order_strategy ?? "smart_adaptive");
    setWebhookEnabled(s.webhook_enabled ?? false);
    setWebhookUrl(s.webhook_url ?? "");
    setWebhookSecret(s.webhook_secret ?? "");
    setWebhookFormat(s.webhook_format ?? "json");
    setExecutionEnabled((s as { execution_enabled?: boolean }).execution_enabled ?? false);
    setExecutionDryRun((s as { execution_dry_run?: boolean }).execution_dry_run !== false);
    setConfirmLive(false);
    setExposureLimitEnabled(
      (s as { exposure_limit_enabled?: boolean }).exposure_limit_enabled === true,
    );

    setEquity(String(Number(s.account_equity ?? 0)));
    setCurrency(s.account_currency ?? "USD");
    setRiskPercent(String(Number(s.risk_per_trade_percent ?? 1)));
    setRiskAckHigh(s.risk_ack_high === true);
    setEquityAsOf(s.equity_as_of ?? null);
    setMaxLots(String(Number(s.max_position_size ?? 0)));
    setLeverage(String(Number(s.leverage ?? 100)));
    setMaxStopPercent(String(Number(s.max_stop_loss_percent ?? 0)));
  }, [settings.data]);

  function toggle(list: string[], value: string, set: (v: string[]) => void) {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  async function onSave() {
    if (!user) return;
    // Bridge fields are validated and written SERVER-SIDE below. There is
    // deliberately no client-side URL check standing in for that: a browser
    // regex cannot classify what a hostname resolves to.


    // Clamped to the same bounds the database enforces, so a save is never
    // rejected by a constraint the user cannot see.
    const num = (v: string, fallback: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };
    const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
    const equityValue = clamp(num(equity, 0), 0, 1e12);
    const riskValue = clamp(num(riskPercent, 1), 0.01, 100);
    // Above 2% is only applied with an explicit, persisted acknowledgement.
    if (riskValue > 2 && !riskAckHigh) {
      toast.error(
        "Risking more than 2% per trade needs the high-risk acknowledgement below before it can be saved.",
      );
      return;
    }
    const equityChanged = Number(settings.data?.account_equity ?? -1) !== equityValue;
    const lotsValue = clamp(num(maxLots, 0), 0, 1000);
    const leverageValue = Math.round(clamp(num(leverage, 100), 1, 3000));
    const stopValue = clamp(num(maxStopPercent, 0), 0, 100);

    setSaving(true);
    try {
      await saveSettings({
        user_id: user.id,
        instruments,
        timeframes,
        sessions,
        min_grade: minGrade,
        alert_min_grade: alertMinGrade,
        daily_setup_cap: cap,
        notify_push: push,
        notify_email: email,
        order_strategy: orderStrategy,
        account_equity: equityValue,
        account_currency: currency,
        risk_per_trade_percent: riskValue,
        max_position_size: lotsValue,
        leverage: leverageValue,
        max_stop_loss_percent: stopValue,
        // Never fabricate the acknowledgement: above-2% saves are blocked above
        // unless the box is ticked, so this only persists the user's own choice.
        risk_ack_high: riskAckHigh,
        // Provenance: user-entered balance, timestamped when it changes.
        ...(equityChanged || !equityAsOf ? { equity_as_of: new Date().toISOString() } : {}),
      });
      // Bridge + execution fields go through the server: the URL is parsed,
      // resolved and classified there, and the validation stamp is written with
      // it. A rejected endpoint leaves the previously validated one untouched.
      const bridge = await persistBridge({
        data: {
          webhookEnabled,
          webhookUrl: webhookUrl.trim(),
          webhookSecret: webhookSecret.trim(),
          webhookFormat,
          executionEnabled,
          executionDryRun,
          confirmLiveExecution: !executionDryRun && confirmLive,
          exposureLimitEnabled,
        },

      });
      await queryClient.invalidateQueries({ queryKey: ["scanner-settings"] });
      await queryClient.invalidateQueries({ queryKey: ["execution-deliveries"] });
      if (!bridge.ok) {
        toast.error(bridge.error ?? "The bridge URL could not be validated");
        return;
      }
      toast.success("Settings saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save settings");
    } finally {
      setSaving(false);
    }
  }

  if (settings.isLoading) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <p className="label-xs">Configuration</p>
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The scanner runs centrally on every instrument and timeframe. These preferences filter what reaches your
          feed and alerts — they never change the scan itself.
        </p>
      </div>

      {settings.isError ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          Could not load your preferences, so the values below may be defaults rather than your saved settings.
          Reload before saving.
        </p>
      ) : null}

      {/* Tabs replace the long scroll: each concern is one screen, and the save
          bar stays pinned under the tabs it applies to. */}
      <Tabs defaultValue="filters" className="space-y-4">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-3 lg:inline-flex lg:h-9 lg:w-auto lg:gap-0">
          <TabsTrigger className="h-10 lg:h-auto" value="filters">Filters &amp; alerts</TabsTrigger>
          <TabsTrigger className="h-10 lg:h-auto" value="risk">Risk</TabsTrigger>
          <TabsTrigger className="h-10 lg:h-auto" value="notifications">Notifications</TabsTrigger>
          <TabsTrigger className="h-10 lg:h-auto" value="agents">Agents</TabsTrigger>
          <TabsTrigger className="h-10 lg:h-auto" value="diagnostics">Diagnostics</TabsTrigger>
          <TabsTrigger className="h-10 lg:h-auto" value="account">Account</TabsTrigger>
        </TabsList>

        <TabsContent value="filters" className="space-y-4">
          <section className="space-y-5 rounded-md border border-border bg-card p-4">
            <h2 className="label-xs">Feed filters</h2>

            <div>
              <Label className="text-xs">Instruments</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {ALL_INSTRUMENTS.map((i) => (
                  <Chip
                    key={i}
                    active={instruments.includes(i)}
                    onClick={() => toggle(instruments, i, setInstruments)}
                  >
                    {i}
                    <span className="ml-1.5 opacity-60">{INSTRUMENT_LABELS[i]}</span>
                  </Chip>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs">Timeframes of interest</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {ALL_TIMEFRAMES.map((t) => (
                  <Chip
                    key={t}
                    active={timeframes.includes(t)}
                    onClick={() => toggle(timeframes, t, setTimeframes)}
                  >
                    {t}
                  </Chip>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs">Active sessions</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {ALL_SESSIONS.map((s) => (
                  <Chip key={s} active={sessions.includes(s)} onClick={() => toggle(sessions, s, setSessions)}>
                    {SESSION_LABELS[s] ?? s}
                  </Chip>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label className="text-xs" htmlFor="min-grade">
                  Minimum grade
                </Label>
                <Select value={minGrade} onValueChange={(v) => setMinGrade(v as Grade)}>
                  <SelectTrigger id="min-grade" className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A+">A+ only — full institutional confluence</SelectItem>
                    <SelectItem value="A">A and above — perfect alignment</SelectItem>
                    <SelectItem value="B">B and above</SelectItem>
                    <SelectItem value="C">C and above — everything</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs" htmlFor="cap">
                  My daily setup cap
                </Label>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[0, 10, 15, 25, 50].map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      size="sm"
                      variant={cap === preset ? "default" : "outline"}
                      className="h-7 px-2 text-xs"
                      onClick={() => setCap(preset)}
                    >
                      {preset === 0 ? "Unlimited" : preset}
                    </Button>
                  ))}
                </div>
                <Input
                  id="cap"
                  type="number"
                  min={0}
                  max={500}
                  className="num mt-2"
                  value={cap}
                  onChange={(e) => setCap(Math.max(0, Math.min(500, Number(e.target.value) || 0)))}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Your own limit on how many graded setups (A+, A, B) reach you per UTC day —{" "}
                  <span className="text-foreground">0 means unlimited</span>. C-Grade never counts against it.
                  The scanner publishes every qualifying setup; this only governs your feed and alerts, and the
                  engine still defaults to No Trade rather than filling the number.
                </p>
              </div>
            </div>
          </section>

          <section className="space-y-4 rounded-md border border-border bg-card p-4">
            <h2 className="label-xs">Alert threshold</h2>
            <div>
              <Label className="text-xs" htmlFor="alert-min-grade">
                Alert minimum grade
              </Label>
              <Select value={alertMinGrade} onValueChange={(v) => setAlertMinGrade(v as Grade)}>
                <SelectTrigger id="alert-min-grade" className="mt-2 sm:max-w-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="A+">A+ only</SelectItem>
                  <SelectItem value="A">A and above</SelectItem>
                  <SelectItem value="B">B and above</SelectItem>
                  <SelectItem value="C">C and above</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                Which tiers may trigger push and email alerts. Independent of your feed minimum grade — set it to
                “C and above” if you want to be alerted on every tier.
              </p>
            </div>
          </section>

          <SaveBar saving={saving} onSave={() => void onSave()} />
        </TabsContent>

        <TabsContent value="risk" className="space-y-4">
          <section className="space-y-5 rounded-md border border-border bg-card p-4">
            <div>
              <h2 className="label-xs">Risk profile</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Every setup in your feed is sized against these numbers. They are used for
                calculation and display only — the scanner, the grades and the alert thresholds
                never read them, and nothing here places an order.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label className="text-xs" htmlFor="equity">
                  Account balance
                </Label>
                <Input
                  id="equity"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  className="num mt-2"
                  value={equity}
                  onChange={(e) => setEquity(e.target.value)}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Required: without a balance there is nothing to take a percentage of, so cards
                  show no lot size rather than a guess. This is the balance{" "}
                  <span className="font-medium">you entered</span> — P-Trades cannot read your
                  broker account, so it is never broker-confirmed.
                </p>
                <p className="num mt-1 text-xs text-muted-foreground">
                  {equityAsOf
                    ? `Last confirmed ${new Date(equityAsOf).toLocaleDateString()}${
                        Date.now() - new Date(equityAsOf).getTime() > 30 * 24 * 3600_000
                          ? " — over a month old, please confirm it is still correct."
                          : ""
                      }`
                    : "Never confirmed — saving will record today's date."}
                </p>
              </div>
              <div>
                <Label className="text-xs" htmlFor="currency">
                  Account currency
                </Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger id="currency" className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  GBP/AUD risk is earned in AUD, so it is converted at the live rate. If that rate
                  is unavailable the card says so instead of assuming parity.
                </p>
              </div>
              <div>
                <Label className="text-xs" htmlFor="risk-percent">
                  Max risk per trade (%)
                </Label>
                <Input
                  id="risk-percent"
                  type="number"
                  inputMode="decimal"
                  min={0.01}
                  max={100}
                  step="0.05"
                  className="num mt-2"
                  value={riskPercent}
                  onChange={(e) => setRiskPercent(e.target.value)}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  The loss if the stop is hit — this is what sets the lot size. 1% is the
                  conservative default and 2% the conventional ceiling.
                </p>
                {Number(riskPercent) > 2 ? (
                  <label className="mt-2 flex items-start gap-2 rounded-sm border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs leading-snug text-warning">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={riskAckHigh}
                      onChange={(e) => setRiskAckHigh(e.target.checked)}
                    />
                    <span>
                      I understand that risking {Number(riskPercent) || 0}% of my balance per trade
                      is above the 2% conventional ceiling and can lose my account materially
                      faster. This acknowledgement is saved with my settings.
                    </span>
                  </label>
                ) : null}
              </div>
              <div>
                <Label className="text-xs" htmlFor="max-lots">
                  Max position size (lots)
                </Label>
                <Input
                  id="max-lots"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={1000}
                  step="0.01"
                  className="num mt-2"
                  value={maxLots}
                  onChange={(e) => setMaxLots(e.target.value)}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Hard ceiling applied after the calculation. 0 means no cap. When it binds, you
                  risk less than your percentage, and the card tells you.
                </p>
              </div>
              <div>
                <Label className="text-xs" htmlFor="leverage">
                  Leverage (1:N)
                </Label>
                <Input
                  id="leverage"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={3000}
                  step="1"
                  className="num mt-2"
                  value={leverage}
                  onChange={(e) => setLeverage(e.target.value)}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Used only to show the margin a size needs. Leverage does not change your risk —
                  the stop distance does.
                </p>
              </div>
              <div>
                <Label className="text-xs" htmlFor="max-stop">
                  Max stop-loss (% of entry)
                </Label>
                <Input
                  id="max-stop"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step="0.05"
                  className="num mt-2"
                  value={maxStopPercent}
                  onChange={(e) => setMaxStopPercent(e.target.value)}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Flags setups whose stop sits further than this from entry. 0 turns the check off.
                  It filters nothing out — wide-stop setups are still shown, just marked.
                </p>
              </div>
            </div>
          </section>

          <RiskPreview
            equity={equity}
            currency={currency}
            riskPercent={riskPercent}
            maxLots={maxLots}
            leverage={leverage}
            maxStopPercent={maxStopPercent}
          />

          <SaveBar saving={saving} onSave={() => void onSave()} />
        </TabsContent>

        <TabsContent value="notifications" className="space-y-4">
          <PushSection enabled={push} onEnabledChange={setPush} />

          <section className="space-y-4 rounded-md border border-border bg-card p-4">
            <h2 className="label-xs">Email delivery</h2>
            <Row
              id="notify-email"
              title="Email alerts"
              desc="Branded alerts sent from notify.getptrades.com — the sender domain is verified and live."
              checked={email}
              onChange={setEmail}
            />
          </section>


          <section className="space-y-5 rounded-md border border-border bg-card p-4">
            <div>
              <h2 className="label-xs">Execution &amp; delivery preferences</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                How the terminal phrases order guidance, and where — if anywhere — a copy of each
                alert is POSTed for your own broker bridge. We never hold broker credentials.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-sm text-foreground">Order guidance (manual)</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                <StrategyOption
                  active={orderStrategy === "smart_adaptive"}
                  onClick={() => setOrderStrategy("smart_adaptive")}
                  title="Smart Adaptive"
                  desc="Market entry while price is inside the safe zone, limit order on the retest once it is beyond the ceiling."
                />
                <StrategyOption
                  active={orderStrategy === "strict_retest"}
                  onClick={() => setOrderStrategy("strict_retest")}
                  title="Strict Break-and-Retest"
                  desc="Limit orders only. The card never suggests a market entry, whatever the live price does."
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Either way, un-filled orders should be cancelled after {ORDER_TIF_MINUTES} minutes
                (2 candles).
              </p>
            </div>

            <div className="space-y-4 border-t border-border pt-4">
              <Row
                id="webhook-enabled"
                title="Enable webhook dispatcher"
                desc="POST every alert-eligible setup to your own bridge (PineConnector, an EA relay, an automation platform). Dispatch is non-blocking and times out after 5 seconds."
                checked={webhookEnabled}
                onChange={setWebhookEnabled}
              />
              {webhookEnabled ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="webhook-url" className="text-sm text-foreground">
                      Webhook URL
                    </Label>
                    <Input
                      id="webhook-url"
                      type="url"
                      inputMode="url"
                      placeholder="https://your-bridge.example.com/hook"
                      value={webhookUrl}
                      onChange={(e) => setWebhookUrl(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="webhook-secret" className="text-sm text-foreground">
                      Webhook secret / licence ID
                    </Label>
                    <Input
                      id="webhook-secret"
                      type="password"
                      autoComplete="off"
                      placeholder="PineConnector licence or shared secret"
                      value={webhookSecret}
                      onChange={(e) => setWebhookSecret(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="webhook-format" className="text-sm text-foreground">
                      Payload format
                    </Label>
                    <Select
                      value={webhookFormat}
                      onValueChange={(v) => setWebhookFormat(v as WebhookFormat)}
                    >
                      <SelectTrigger id="webhook-format">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pineconnector">PineConnector (comma separated)</SelectItem>
                        <SelectItem value="json">JSON</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-xs text-muted-foreground sm:col-span-2">
                    Orders are always dispatched as buy/sell <span className="num">limit</span> at the
                    structural entry with the {ORDER_TIF_MINUTES}-minute expiry attached — never a
                    stop order, which your platform would reject once price has passed the level.
                  </p>
                  <div className="space-y-2 border-t border-border pt-3 sm:col-span-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void onSendTestWebhook()}
                        disabled={!canTestWebhook || testingWebhook}
                      >
                        <Send className={cn("mr-2 h-4 w-4", testingWebhook && "animate-pulse")} />
                        {testingWebhook ? "Sending…" : "Send Test Webhook"}
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        {canTestWebhook
                          ? webhookFormat === "pineconnector"
                            ? "Shows the payload shape locally. Nothing is sent: every PineConnector command is a real order, so it is never used as a connectivity test."
                            : "Posts a non-executable {\"event\":\"test\"} body to your validated URL. No action, no quantity, nothing written to the database."
                          : "Save a valid https URL and your secret / licence ID to enable the test."}
                      </p>
                    </div>
                    {testPreview ? (
                      <pre className="num overflow-x-auto rounded-md border border-border bg-background p-3 text-xs text-muted-foreground">
                        {testPreview}
                      </pre>
                    ) : null}
                  </div>

                  <div className="space-y-4 border-t border-border pt-4 sm:col-span-2">
                    <div>
                      <h3 className="label-xs">Automated execution</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {savedValidatedAt
                          ? `Bridge endpoint validated ${new Date(savedValidatedAt).toLocaleString()}.`
                          : "Save the bridge URL to validate the endpoint. Nothing is dispatched until it passes."}
                      </p>
                    </div>

                    <Row
                      id="execution-enabled"
                      title="Send orders automatically"
                      desc="Queue every alert-eligible setup for delivery to your bridge. Each queued order is re-checked against live price, spread, session, your daily cap and your risk guardrails immediately before it is sent."
                      checked={executionEnabled}
                      onChange={setExecutionEnabled}
                    />
                    <Row
                      id="execution-dry-run"
                      title="Dry run"
                      desc="Validate and sign each order but never POST it. Leave this on until the delivery log looks right — it exercises the entire path without touching your broker."
                      checked={executionDryRun}
                      onChange={(v) => {
                        setExecutionDryRun(v);
                        if (v) setConfirmLive(false);
                      }}
                    />
                    {!executionDryRun ? (
                      <label className="flex gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 shrink-0 accent-destructive"
                          checked={confirmLive}
                          onChange={(e) => setConfirmLive(e.target.checked)}
                        />
                        <span>
                          <span className="font-semibold text-foreground">
                            I confirm live execution.
                          </span>{" "}
                          Eligible setups may create real broker orders at{" "}
                          <span className="num">{hostOf(webhookUrl) || "your bridge host"}</span>{" "}
                          without another manual click. Policy:{" "}
                          <span className="num">single_exit_first_target</span> — one pending
                          buy/sell limit exiting at the first target. Position size comes solely
                          from your saved risk profile and your broker's contract specification;
                          no quantity is ever invented. This confirmation applies to the current
                          configuration only — changing your bridge, secret, format, risk profile,
                          instruments, sessions, alert grade or daily cap returns you to dry run
                          until you confirm again. Live execution also has to be available
                          system-wide.
                        </span>
                      </label>
                    ) : null}
                    <Row
                      id="exposure-limit-enabled"
                      title="Block orders when my logged exposure is too high"
                      desc="Off by default. This limit is calculated solely from trades you logged in P-Trades — it is not your broker-account exposure, and a missing journal entry is not proof that you have no open position. When on, an order is not sent once your logged open + pending risk or logged loss today passes the limit."
                      checked={exposureLimitEnabled}
                      onChange={setExposureLimitEnabled}
                    />


                    <p className="text-xs text-muted-foreground">
                      {executionStatus.data
                        ? executionStatus.data.liveEnabled
                          ? executionStatus.data.forceDryRun
                            ? "Live execution is enabled system-wide but currently forced to dry run, so nothing is sent to any bridge."
                            : `Live execution is enabled system-wide. ${executionStatus.data.policyNote}`
                          : "Live execution is disabled system-wide. Orders are queued and validated but never sent."
                        : "Checking system execution status…"}
                    </p>

                    {deliveries.data?.length ? (
                      <div className="space-y-1 rounded-md border border-border bg-background p-3 font-mono text-xs">
                        <p className="text-muted-foreground">Recent deliveries</p>
                        {deliveries.data.map((d) => (
                          <p key={d.id} className="truncate">
                            <span
                              className={cn(
                                d.state === "acknowledged"
                                  ? "text-primary"
                                  : d.state === "rejected" || d.state === "failed"
                                    ? "text-destructive"
                                    : "text-foreground",
                              )}
                            >
                              {d.state}
                            </span>
                            {d.dry_run ? " · dry run" : ""}
                            {d.endpoint_host ? ` · ${d.endpoint_host}` : ""}
                            {d.http_status ? ` · ${d.http_status}` : ""}
                            {d.reason ? ` · ${d.reason}` : ""}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No deliveries yet. Rows appear here once a setup is queued for your bridge.
                      </p>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </section>


          <SaveBar saving={saving} onSave={() => void onSave()} />
        </TabsContent>

        <TabsContent value="agents" className="space-y-4">
          <AgentConnectCard />
        </TabsContent>

        <TabsContent value="diagnostics" className="space-y-4">
          <section className="space-y-3 rounded-md border border-border bg-card p-4">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:justify-between">
              <div className="min-w-0">
                <h2 className="label-xs">Scanner diagnostics</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  The scan runs automatically every 15 minutes. Run it on demand to verify the pipeline end to end.
                </p>
              </div>
              <Button variant="outline" onClick={onRunScanNow} disabled={scanning} className="shrink-0">
                <RefreshCw className={cn("mr-2 h-4 w-4", scanning && "animate-spin")} />
                {scanning ? "Scanning…" : "Run scan now"}
              </Button>
            </div>

            {scanReport && (
              <div className="space-y-1 rounded border border-border bg-background p-3 font-mono text-xs">
                <p className="text-muted-foreground">
                  run {scanReport.runId.slice(0, 8)} · {scanReport.enqueued} enqueued
                </p>
                {scanReport.processed.length === 0 && <p className="text-muted-foreground">No jobs processed.</p>}
                {scanReport.processed.map((p, i) => (
                  <p key={`${p.instrument}-${i}`}>
                    <span className="text-foreground">{p.instrument}</span>{" "}
                    <span
                      className={cn(
                        p.status === "failed"
                          ? "text-destructive"
                          : p.status === "published"
                            ? "text-emerald-400"
                            : "text-muted-foreground",
                      )}
                    >
                      {p.status}
                    </span>
                    {p.detail ? <span className="text-muted-foreground"> — {p.detail}</span> : null}
                  </p>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3 rounded-md border border-border bg-card p-4">
            <h2 className="label-xs">Sender domain · getptrades.com</h2>
            <p className="text-sm text-muted-foreground">
              <span className="num text-long">Verified</span> — alerts send from{" "}
              <span className="num text-foreground">notify.getptrades.com</span>. The records below are the
              delegation currently in place; keep them at your registrar so deliverability stays intact.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {["Type", "Name / Host", "Value", ""].map((h) => (
                      <th key={h} className="label-xs px-3 py-2 text-left">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DNS_RECORDS.map((r, i) => (
                    <tr key={i} className="border-b border-border/60 last:border-0">
                      <td className="num px-3 py-2 text-xs">{r.type}</td>
                      <td className="num px-3 py-2 text-xs">{r.name}</td>
                      <td className="num px-3 py-2 text-xs break-all text-muted-foreground">{r.value}</td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Copy ${r.type} record value`}
                          onClick={() => {
                            // Never claim success the clipboard did not deliver.
                            void navigator.clipboard
                              .writeText(r.value)
                              .then(() => toast.success("Copied"))
                              .catch(() => toast.error("Clipboard blocked — copy the value manually"));
                          }}
                        >
                          <Copy className="size-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
              <li>These NS records delegate the notify subdomain so SPF, DKIM and MX are managed for you.</li>
              <li>Removing them stops alert delivery from notify.getptrades.com.</li>
              <li>New sending domains warm up over 2–4 weeks — deliverability improves as volume stays steady.</li>
            </ol>
          </section>
        </TabsContent>

        <TabsContent value="account" className="space-y-4">
          <FeedbackSection defaultEmail={user?.email ?? ""} />
          <DangerZoneSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SaveBar({ saving, onSave }: { saving: boolean; onSave: () => void }) {
  return (
    <div className="flex justify-end">
      <Button onClick={onSave} disabled={saving}>
        <Save className="size-4" /> {saving ? "Saving…" : "Save settings"}
      </Button>
    </div>
  );
}

function StrategyOption({
  active,
  onClick,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "rounded-md border p-3 text-left transition-colors",
        active ? "border-primary/60 bg-primary/10" : "border-border bg-surface hover:border-border/80",
      )}
    >
      <span className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex size-4 shrink-0 items-center justify-center rounded-full border",
            active ? "border-primary" : "border-muted-foreground/50",
          )}
        >
          {active ? <span className="size-2 rounded-full bg-primary" /> : null}
        </span>
        <span className="text-sm font-semibold text-foreground">{title}</span>
      </span>
      <span className="mt-1.5 block text-xs leading-relaxed text-muted-foreground">{desc}</span>
    </button>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "num rounded-sm border px-2.5 py-1.5 text-xs transition-colors",
        active
          ? "border-primary/50 bg-primary/15 text-primary"
          : "border-border bg-surface text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Row({
  id,
  title,
  desc,
  checked,
  onChange,
}: {
  id: string;
  title: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <Label htmlFor={id} className="text-sm text-foreground">
          {title}
        </Label>
        <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/**
 * Shows only what can be derived from the profile itself — the cash at stake per
 * trade and the margin headroom. Deliberately no example entry/stop prices: a
 * worked setup would be invented data, and real sizing appears on live cards.
 */
function RiskPreview({
  equity,
  currency,
  riskPercent,
  maxLots,
  leverage,
  maxStopPercent,
}: {
  equity: string;
  currency: string;
  riskPercent: string;
  maxLots: string;
  leverage: string;
  maxStopPercent: string;
}) {
  const eq = Number(equity);
  const rp = Number(riskPercent);
  const lev = Number(leverage);
  const cap = Number(maxLots);
  const stopCeiling = Number(maxStopPercent);

  if (!Number.isFinite(eq) || eq <= 0 || !Number.isFinite(rp) || rp <= 0) {
    return (
      <section className="rounded-md border border-border bg-card p-4">
        <h2 className="label-xs">What this means per trade</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Enter a balance and a risk percentage to see the cash at stake per trade.
        </p>
      </section>
    );
  }

  const budget = (eq * rp) / 100;
  const buyingPower = Number.isFinite(lev) && lev > 0 ? eq * lev : null;

  return (
    <section className="rounded-md border border-border bg-card p-4">
      <h2 className="label-xs">What this means per trade</h2>
      <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="min-w-0">
          <dt className="label-xs">Risk per trade</dt>
          <dd className="num text-base font-semibold text-short">{money(budget, currency)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="label-xs">Losses to halve account</dt>
          <dd className="num text-base font-semibold">{Math.ceil(50 / rp)} in a row</dd>
        </div>
        <div className="min-w-0">
          <dt className="label-xs">Max position value</dt>
          <dd className="num text-base font-semibold">
            {buyingPower === null ? "—" : money(buyingPower, currency)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="label-xs">Lot ceiling</dt>
          <dd className="num text-base font-semibold">
            {Number.isFinite(cap) && cap > 0 ? cap.toFixed(2) : "None"}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs leading-snug text-muted-foreground">
        A setup whose stop is more than{" "}
        {Number.isFinite(stopCeiling) && stopCeiling > 0
          ? `${stopCeiling}% from entry will be marked as wider than your tolerance`
          : "your tolerance will not be marked, because the stop-loss check is off"}
        .
      </p>
    </section>
  );
}
