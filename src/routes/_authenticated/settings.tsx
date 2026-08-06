import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, RefreshCw, Save } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { runScanNow, type ManualScanResult } from "@/lib/scanner/scan.functions";

import { useAuth } from "@/hooks/useAuth";
import { saveSettings, settingsQuery } from "@/lib/queries";
import { ALL_INSTRUMENTS, ALL_SESSIONS, ALL_TIMEFRAMES, SESSION_LABELS, INSTRUMENT_LABELS, type Grade } from "@/lib/db-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

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

function SettingsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const settings = useQuery(settingsQuery(user?.id));

  const [instruments, setInstruments] = useState<string[]>([...ALL_INSTRUMENTS]);
  const [timeframes, setTimeframes] = useState<string[]>([...ALL_TIMEFRAMES]);
  const [sessions, setSessions] = useState<string[]>([...ALL_SESSIONS]);
  const [minGrade, setMinGrade] = useState<Grade>("C");
  const [alertMinGrade, setAlertMinGrade] = useState<Grade>("B");
  const [cap, setCap] = useState(30);
  const [push, setPush] = useState(true);
  const [email, setEmail] = useState(false);
  const [saving, setSaving] = useState(false);
  const triggerScan = useServerFn(runScanNow);
  const [scanning, setScanning] = useState(false);
  const [scanReport, setScanReport] = useState<ManualScanResult | null>(null);

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
  }, [settings.data]);

  function toggle(list: string[], value: string, set: (v: string[]) => void) {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  async function onSave() {
    if (!user) return;
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
      });
      await queryClient.invalidateQueries({ queryKey: ["scanner-settings"] });
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
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The scanner runs centrally on every instrument and timeframe. These preferences filter what reaches your
          feed and alerts — they never change the scan itself.
        </p>
      </div>

      <section className="space-y-3 rounded-md border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="label-xs">Scanner diagnostics</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The scan runs automatically every 15 minutes. Run it on demand to verify the pipeline end to end.
            </p>
          </div>
          <Button variant="outline" onClick={onRunScanNow} disabled={scanning}>
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



      <section className="space-y-5 rounded-md border border-border bg-card p-4">
        <p className="label-xs">Feed filters</p>

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
              <Chip key={t} active={timeframes.includes(t)} onClick={() => toggle(timeframes, t, setTimeframes)}>
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
              Daily setup cap
            </Label>
            <Input
              id="cap"
              type="number"
              min={1}
              max={30}
              className="num mt-2"
              value={cap}
              onChange={(e) => setCap(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Hard ceiling is 30/day and only A+, A and B setups deduct from it — C-Grade publishes outside the
              quota. The engine defaults to No Trade rather than filling the cap.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-md border border-border bg-card p-4">
        <p className="label-xs">Alerts</p>
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
        <Row
          id="notify-push"
          title="Browser & Android push"
          desc="Fires when a new signal at or above your alert minimum grade is inserted by the scanner."
          checked={push}
          onChange={(v) => {
            setPush(v);
            if (v && typeof Notification !== "undefined" && Notification.permission === "default") {
              void Notification.requestPermission();
            }
          }}
        />
        <Row
          id="notify-email"
          title="Email alerts"
          desc="Branded alerts sent from notify.getptrades.com — the sender domain is verified and live."
          checked={email}
          onChange={setEmail}
        />
      </section>


      <section className="space-y-3 rounded-md border border-border bg-card p-4">
        <p className="label-xs">Sender domain · getptrades.com</p>
        <p className="text-sm text-muted-foreground">
          <span className="num text-long">Verified</span> — alerts send from{" "}
          <span className="num text-foreground">notify.getptrades.com</span>. The records below are the
          delegation currently in place; keep them at your registrar so deliverability stays intact.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
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
                      onClick={() => {
                        void navigator.clipboard.writeText(r.value);
                        toast.success("Copied");
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

      <div className="flex justify-end">
        <Button onClick={() => void onSave()} disabled={saving}>
          <Save className="size-4" /> {saving ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </div>
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
