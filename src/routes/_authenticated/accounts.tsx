/**
 * /accounts — connect and observe your own broker account.
 *
 * Presentation rules baked in:
 *  - Every broker figure is labelled BROKER-REPORTED with the instant it was
 *    observed. Nothing is shown as broker-confirmed before the broker answered.
 *  - The demo/live choice is labelled as intent, and a contradiction from the
 *    broker is a full-width stop, not a footnote.
 *  - The secure credential page URL is opened once and never rendered as text
 *    that could be copied into a log or a screenshot archive.
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ExternalLink,
  Eye,
  Zap,
  HelpCircle,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { describePhase } from "@/lib/accounts/lifecycle";
import { CONNECTION_REGIONS, HELP_TOPICS, capabilityNote } from "@/lib/accounts/guidance";
import type { AccountMode, ConnectedAccountView } from "@/lib/accounts/types";
import { getExecutionStatus } from "@/lib/execution.functions";
import {
  adoptBrokerConnection,
  disconnectBrokerConnection,
  getAccountQuota,
  listConnectedAccounts,
  refreshBrokerConnection,
  reissueBrokerConfigurationLink,
  resolveAmbiguousSymbol,
  setAccountExposureBoundary,
  setAccountResearchConsent,
  setBrokerAccountMode,
  startBrokerConnection,
} from "@/lib/accounts.functions";

export const Route = createFileRoute("/_authenticated/accounts")({
  head: () => ({
    meta: [
      { title: "Broker Accounts — P-Trades Hub" },
      {
        name: "description",
        content:
          "Connect your MetaTrader account to P-Trades Hub in observe mode. Your broker reports the account facts; P-Trades never stores your password.",
      },
      { property: "og:title", content: "Broker Accounts — P-Trades Hub" },
      {
        property: "og:description",
        content:
          "Link a demo or live MetaTrader account and see broker-reported balance, equity and symbol mapping.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AccountsPage,
});

function Money({ value, currency }: { value: number | null; currency: string | null }) {
  if (value === null) return <span className="text-muted-foreground">unavailable</span>;
  return (
    <span className="num">
      {value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
      {currency ? ` ${currency}` : ""}
    </span>
  );
}

function AccountsPage() {
  const queryClient = useQueryClient();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);

  const accounts = useQuery({
    queryKey: ["connected-accounts"],
    queryFn: () => listConnectedAccounts(),
  });
  const quota = useQuery({ queryKey: ["account-quota"], queryFn: () => getAccountQuota() });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["connected-accounts"] });
    void queryClient.invalidateQueries({ queryKey: ["account-quota"] });
  };

  const list = accounts.data ?? [];
  const canAddDemo = (quota.data?.usedDemo ?? 0) < (quota.data?.maxDemo ?? 0);
  const canAddLive = (quota.data?.usedLive ?? 0) < (quota.data?.maxLive ?? 0);

  const armed = list.filter((account) => account.mode !== "observe");

  // The signed-in layout (src/routes/_authenticated/route.tsx) already supplies
  // AppShell and the page container, so this route must not wrap itself again —
  // doing so rendered the header and navigation twice on this screen only.
  return (
    <>
      <div className="mx-auto max-w-[1100px]">
        <header className="mb-5">
          <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Broker Accounts</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{capabilityNote(list)}</p>
        </header>

        <div className="mb-4 rounded-sm border border-border bg-surface p-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2 font-medium text-foreground">
            {armed.length === 0 ? (
              <>
                <Eye className="size-4" /> Observe mode — nothing armed yet
              </>
            ) : (
              <>
                <Zap className="size-4" /> Automatic orders armed
              </>
            )}
          </div>
          <p className="mt-1">
            P-Trades never receives or stores your MetaTrader password. You enter it on your
            broker-connection provider&rsquo;s own secure page.
          </p>
        </div>

        {list.length > 0 ? <EmergencyStopPanel accounts={list} onChanged={invalidate} /> : null}


        {accounts.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading your connections…</p>
        ) : list.length === 0 ? (
          <div className="rounded-sm border border-dashed border-border p-6 text-center">
            <Building2 className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium">No broker account connected yet</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              Connecting one lets P-Trades show your broker&rsquo;s own balance, equity and symbol
              names beside each signal. A demo account can also be armed for automatic orders once
              your broker confirms it as DEMO — that is your choice, and it stays off until you make
              it.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {list.map((account) => (
              <AccountCard key={account.id} account={account} onChanged={invalidate} />
            ))}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button
            onClick={() => {
              setLinkOpen(false);
              setWizardOpen(true);
            }}
            disabled={!canAddDemo && !canAddLive}
          >
            <Plus className="size-4" /> Connect a broker account
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setWizardOpen(false);
              setLinkOpen(true);
            }}
            disabled={!canAddDemo && !canAddLive}
          >
            <Link2 className="size-4" /> Link an account I already have
          </Button>
          {quota.data ? (
            <span className="num text-xs text-muted-foreground">
              {quota.data.usedDemo}/{quota.data.maxDemo} demo · {quota.data.usedLive}/
              {quota.data.maxLive} live
            </span>
          ) : null}
        </div>

        {wizardOpen ? (
          <ConnectWizard
            canAddDemo={canAddDemo}
            canAddLive={canAddLive}
            onClose={() => setWizardOpen(false)}
            onDone={invalidate}
          />
        ) : null}

        {linkOpen ? (
          <LinkExistingAccount
            canAddDemo={canAddDemo}
            canAddLive={canAddLive}
            onClose={() => setLinkOpen(false)}
            onDone={invalidate}
          />
        ) : null}

        <section className="mt-8">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <HelpCircle className="size-4" /> Where do I find this?
          </h2>
          <Accordion type="single" collapsible className="rounded-sm border border-border">
            {HELP_TOPICS.map((topic) => (
              <AccordionItem key={topic.id} value={topic.id} className="px-3">
                <AccordionTrigger className="text-left text-sm">{topic.question}</AccordionTrigger>
                <AccordionContent className="text-xs text-muted-foreground">
                  <p>{topic.answer}</p>
                  {topic.whereToLook.length > 0 ? (
                    <ul className="mt-2 list-disc space-y-1 pl-4">
                      {topic.whereToLook.map((where) => (
                        <li key={where}>{where}</li>
                      ))}
                    </ul>
                  ) : null}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>
      </div>
    </>
  );
}

/**
 * Link a trading account the owner already provisioned with the provider. No
 * account is created and no credentials are entered here: the provider already
 * holds them, so this only attaches the existing account to this P-Trades user.
 */
function LinkExistingAccount({
  canAddDemo,
  canAddLive,
  onClose,
  onDone,
}: {
  canAddDemo: boolean;
  canAddLive: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const adopt = useServerFn(adoptBrokerConnection);
  const [intent, setIntent] = useState<"demo" | "live">(canAddDemo ? "demo" : "live");
  const [label, setLabel] = useState("");
  const [metaapiAccountId, setMetaapiAccountId] = useState("");

  const mutation = useMutation({
    mutationFn: () => adopt({ data: { label, metaapiAccountId, intent } }),
    onSuccess: () => {
      onDone();
      toast.success(
        "Account linked. Press Refresh on the connection to check it with your broker.",
      );
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="mt-5 rounded-sm border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Link an account you already have</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Use this when the account already exists with your broker-connection provider. P-Trades
        reads the platform, broker server and region from the provider&rsquo;s own record — you do
        not enter credentials, and nothing new is created or charged.
      </p>

      <div className="mt-3 space-y-3">
        <div className="flex gap-2">
          <Button
            variant={intent === "demo" ? "default" : "outline"}
            disabled={!canAddDemo}
            onClick={() => setIntent("demo")}
          >
            Demo account (automatic orders optional)
          </Button>
          <Button
            variant={intent === "live" ? "default" : "outline"}
            disabled={!canAddLive}
            onClick={() => setIntent("live")}
          >
            Live account (observe only)
          </Button>
        </div>
        <div>
          <Label htmlFor="existing-id">Trading account id</Label>
          <Input
            id="existing-id"
            className="num mt-1"
            placeholder="00000000-0000-0000-0000-000000000000"
            value={metaapiAccountId}
            onChange={(e) => setMetaapiAccountId(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Copy it from your broker-connection provider&rsquo;s MT Accounts page. Accounts reserved
            by P-Trades itself cannot be linked.
          </p>
        </div>
        <div>
          <Label htmlFor="existing-label">Name this connection</Label>
          <Input
            id="existing-label"
            className="mt-1"
            placeholder="My demo account"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <Button
          size="sm"
          disabled={
            label.trim().length < 2 || metaapiAccountId.trim().length < 36 || mutation.isPending
          }
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          Link this account
        </Button>
      </div>
    </div>
  );
}

function ConnectWizard({
  canAddDemo,
  canAddLive,
  onClose,
  onDone,
}: {
  canAddDemo: boolean;
  canAddLive: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const start = useServerFn(startBrokerConnection);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [intent, setIntent] = useState<"demo" | "live">(canAddDemo ? "demo" : "live");
  const [platform, setPlatform] = useState<"mt4" | "mt5">("mt5");
  const [label, setLabel] = useState("");
  const [brokerServer, setBrokerServer] = useState("");
  const [region, setRegion] = useState<string>("london");
  const [provisioningPending, setProvisioningPending] = useState(false);

  const mutation = useMutation({
    mutationFn: () => start({ data: { label, platform, brokerServer, region, intent } }),
    onSuccess: (result) => {
      onDone();
      setStep(4);
      setProvisioningPending(result.provisioningPending);
      if (result.configurationUrl) {
        // Opened, never rendered or stored: the URL grants credential entry.
        window.open(result.configurationUrl, "_blank", "noopener,noreferrer");
      } else if (!result.provisioningPending) {
        toast.error(
          "Your broker-connection provider did not return a secure page. Refresh the connection to retry.",
        );
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="mt-5 rounded-sm border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Connect a broker account — step {step} of 4</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>

      {step === 1 ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Which account are you connecting? This is your starting point only — once connected,
            your broker tells P-Trades what the account really is, and P-Trades stops if the two
            disagree.
          </p>
          <div className="flex gap-2">
            <Button
              variant={intent === "demo" ? "default" : "outline"}
              disabled={!canAddDemo}
              onClick={() => setIntent("demo")}
            >
              Demo account (automatic orders optional)
            </Button>
            <Button
              variant={intent === "live" ? "default" : "outline"}
              disabled={!canAddLive}
              onClick={() => setIntent("live")}
            >
              Live account (observe only)
            </Button>
          </div>
          <Button size="sm" onClick={() => setStep(2)}>
            Continue
          </Button>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-3">
          <div>
            <Label htmlFor="platform">Which app did your broker give you?</Label>
            <Select value={platform} onValueChange={(v) => setPlatform(v as "mt4" | "mt5")}>
              <SelectTrigger id="platform" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mt5">MetaTrader 5 (MT5)</SelectItem>
                <SelectItem value="mt4">MetaTrader 4 (MT4)</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              Check the title bar of your MetaTrader app, or your broker&rsquo;s welcome email.
            </p>
          </div>
          <div>
            <Label htmlFor="server">Broker server name</Label>
            <Input
              id="server"
              className="mt-1"
              placeholder="MetaQuotes-Demo"
              value={brokerServer}
              onChange={(e) => setBrokerServer(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Copy it exactly as MetaTrader shows it in File → Login to Trade Account, including any
              dash and number.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button size="sm" disabled={brokerServer.trim().length < 3} onClick={() => setStep(3)}>
              Continue
            </Button>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-3">
          <div>
            <Label htmlFor="label">Name this connection</Label>
            <Input
              id="label"
              className="mt-1"
              placeholder="My demo account"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="region">Connection region</Label>
            <Select value={region} onValueChange={setRegion}>
              <SelectTrigger id="region" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONNECTION_REGIONS.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="rounded-sm border border-border p-2 text-xs text-muted-foreground">
            Next, a secure page from your broker-connection provider opens in a new tab. Your
            MetaTrader login and password are entered there. P-Trades never sees them.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setStep(2)}>
              Back
            </Button>
            <Button
              size="sm"
              disabled={label.trim().length < 2 || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Create connection &amp; open secure page
            </Button>
          </div>
        </div>
      ) : null}

      {step === 4 ? (
        <div className="space-y-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            {provisioningPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4 text-success" />
            )}
            {provisioningPending
              ? "Provider is still creating the connection"
              : "Connection created"}
          </p>
          {provisioningPending ? (
            <p className="text-xs text-muted-foreground">
              This attempt is still processing. Wait for the provider, close this panel, then press
              <strong> Refresh</strong> on the connection. P-Trades will reuse the same transaction
              id so it does not create a duplicate.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Enter your MetaTrader login on the secure page that just opened. Then come back and
              press
              <strong> Refresh</strong> on the connection below. P-Trades will show it as Ready only
              once your broker itself confirms the account.
            </p>
          )}
          <Button size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      ) : null}
    </div>
  );
}

const MODE_LABELS: Record<AccountMode, string> = {
  observe: "Observe",
  demo_auto: "Demo auto",
  live_confirm: "Live on confirmation",
  live_auto: "Live auto",
};

/** What arming each mode actually authorises, in the trader's own terms. */
const MODE_NOTES: Record<AccountMode, string> = {
  observe:
    "P-Trades never places an order on this account. It only shows what your broker reports.",
  demo_auto:
    "P-Trades will place orders on this DEMO account automatically when a setup passes every alert and execution check. Demo money only — but it is still your account, and you are authorising it now.",
  live_confirm:
    "P-Trades will prepare real-money orders on this account and send nothing until you confirm each one.",
  live_auto:
    "P-Trades will place REAL-MONEY orders on this account automatically. Only arm this if you accept losses without any further prompt.",
};

function AccountCard({
  account,
  onChanged,
}: {
  account: ConnectedAccountView;
  onChanged: () => void;
}) {
  const refresh = useServerFn(refreshBrokerConnection);
  const reissue = useServerFn(reissueBrokerConfigurationLink);
  const disconnect = useServerFn(disconnectBrokerConnection);
  const chooseSymbol = useServerFn(resolveAmbiguousSymbol);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const phase = describePhase(account.phase);
  const toneClass =
    phase.tone === "ok"
      ? "text-success"
      : phase.tone === "error"
        ? "text-destructive"
        : "text-muted-foreground";

  const refreshMutation = useMutation({
    mutationFn: () => refresh({ data: { accountId: account.id } }),
    onSuccess: () => onChanged(),
    onError: (err: Error) => toast.error(err.message),
  });
  const reissueMutation = useMutation({
    mutationFn: () => reissue({ data: { accountId: account.id } }),
    onSuccess: (result) => window.open(result.configurationUrl, "_blank", "noopener,noreferrer"),
    onError: (err: Error) => toast.error(err.message),
  });
  const disconnectMutation = useMutation({
    mutationFn: (vars: { force: boolean }) =>
      disconnect({ data: { accountId: account.id, force: vars.force } }),
    onSuccess: (result) => {
      setDisconnectError(null);
      setConfirmOpen(false);
      toast.success(result.summary);
      onChanged();
    },
    // The provider refused removal. Keep the dialog open and offer an explicit
    // release so a failed provider call can never trap the connection slot.
    onError: (err: Error) => setDisconnectError(err.message),
  });
  const symbolMutation = useMutation({
    mutationFn: (vars: { canonicalSymbol: string; brokerSymbol: string }) =>
      chooseSymbol({ data: { accountId: account.id, ...vars } }),
    onSuccess: () => onChanged(),
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <article className="rounded-sm border border-border bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{account.label}</h3>
            <Badge variant="outline" className="num uppercase">
              {account.platform}
            </Badge>
            {account.ready ? (
              <Badge className="uppercase">{account.broker.accountType}</Badge>
            ) : (
              <Badge variant="secondary">Not verified yet</Badge>
            )}
            {account.readOnly ? <Badge variant="outline">Read-only</Badge> : null}
            <Badge variant={account.mode === "observe" ? "outline" : "default"}>
              {MODE_LABELS[account.mode]}
            </Badge>
            {account.isBenchmark ? <Badge variant="secondary">Benchmark</Badge> : null}
          </div>
          <p className={cn("mt-1 text-xs font-medium", toneClass)}>{phase.label}</p>
          <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">{phase.detail}</p>
          {phase.nextAction ? (
            <p className="mt-1 text-xs text-foreground">Next: {phase.nextAction}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={refreshMutation.isPending}
            onClick={() => refreshMutation.mutate()}
          >
            {refreshMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Refresh
          </Button>
          {!account.ready && account.configurationPageAvailable ? (
            <Button
              size="sm"
              variant="outline"
              disabled={reissueMutation.isPending}
              onClick={() => reissueMutation.mutate()}
            >
              <ExternalLink className="size-4" /> Secure login page
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setConfirmOpen(true)}>
            <Unplug className="size-4" /> Disconnect
          </Button>
        </div>
      </div>

      {account.intentConflict && account.intentConflictReason ? (
        <div className="flex gap-2 border-b border-destructive/40 bg-destructive/10 p-3 text-xs">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <p className="font-semibold text-destructive">
              Stopped: this is not the account you chose
            </p>
            <p className="mt-1">{account.intentConflictReason}</p>
          </div>
        </div>
      ) : null}

      {account.lastError ? (
        <p className="border-b border-border p-3 text-xs text-muted-foreground">
          Last problem reported: {account.lastError}
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-3 p-3 text-xs sm:grid-cols-4">
        <Fact label="Broker" value={account.broker.name ?? "unavailable"} />
        <Fact label="Login" value={account.broker.loginMasked ?? "unavailable"} />
        <Fact label="Server" value={account.brokerServer ?? "unavailable"} />
        <Fact
          label="Your onboarding choice"
          value={account.intent === "demo" ? "Demo (intent)" : "Live (intent)"}
        />
        <Fact
          label="Balance"
          value={<Money value={account.broker.balance} currency={account.broker.currency} />}
        />
        <Fact
          label="Equity"
          value={<Money value={account.broker.equity} currency={account.broker.currency} />}
        />
        <Fact
          label="Free margin"
          value={<Money value={account.broker.freeMargin} currency={account.broker.currency} />}
        />
        <Fact
          label="Leverage"
          value={account.broker.leverage === null ? "unavailable" : `1:${account.broker.leverage}`}
        />
      </dl>

      <p className="px-3 pb-3 text-[11px] text-muted-foreground">
        {account.broker.observedAt
          ? `Broker-reported — read from your broker at ${new Date(account.broker.observedAt).toUTCString()}. Your risk equity in Settings is your own figure and is never overwritten by this.`
          : "No broker figures yet — your broker has not reported this account."}
      </p>

      <ArmingSection account={account} onChanged={onChanged} />
      <ExposureSection account={account} onChanged={onChanged} />
      {!account.isBenchmark ? (
        <ResearchConsentSection account={account} onChanged={onChanged} />
      ) : null}

      {account.features || account.telemetry || account.riskBreaches.length > 0 ? (
        <div className="border-t border-border p-3 text-xs">
          <p className="font-medium">Broker monitoring</p>
          <ul className="mt-1 space-y-1 text-muted-foreground">
            <li>
              Broker statistics:{" "}
              {account.features?.metastats_api_enabled
                ? account.telemetry
                  ? account.telemetry.status === "ok"
                    ? `read from your broker at ${new Date(account.telemetry.observedAt ?? "").toUTCString()}`
                    : account.telemetry.status === "processing"
                      ? "your broker's statistics service is still preparing this account — no figures yet"
                      : (account.telemetry.reason ?? "the statistics service refused the request")
                  : "enabled — no reading collected yet"
                : "not enabled for this account, so no broker statistics are collected"}
            </li>
            <li>
              Drawdown watch:{" "}
              {account.features?.risk_guardian_available
                ? account.riskBreaches.length === 0
                  ? "watching — no drawdown breach reported"
                  : `${account.riskBreaches.length} drawdown breach${account.riskBreaches.length === 1 ? "" : "es"} reported by your broker`
                : (account.features?.risk_guardian_reason ??
                  "not available on this account, so nothing is being watched")}
            </li>
          </ul>
          {account.riskBreaches.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {account.riskBreaches.map((breach) => (
                <li key={breach.eventAt} className="num">
                  {new Date(breach.eventAt).toUTCString()} —{" "}
                  {breach.relativeDrawdown === null
                    ? "drawdown figure unavailable"
                    : `${(breach.relativeDrawdown * 100).toFixed(2)}% relative drawdown`}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {account.symbols.length > 0 ? (
        <div className="border-t border-border p-3 text-xs">
          <p className="font-medium">Your broker&rsquo;s symbol names</p>
          <ul className="mt-1 space-y-2">
            {account.symbols.map((s) => (
              <li key={s.canonical_symbol} className="flex flex-wrap items-center gap-2">
                <span className="num font-medium">{s.canonical_symbol}</span>
                <span className="text-muted-foreground">→</span>
                {s.broker_symbol ? (
                  <span className="num">{s.broker_symbol}</span>
                ) : s.mapping_kind === "ambiguous" ? (
                  <>
                    <span className="text-destructive">several possible matches — choose one</span>
                    {s.candidates.map((candidate) => (
                      <Button
                        key={candidate}
                        size="sm"
                        variant="outline"
                        disabled={symbolMutation.isPending}
                        onClick={() =>
                          symbolMutation.mutate({
                            canonicalSymbol: s.canonical_symbol,
                            brokerSymbol: candidate,
                          })
                        }
                      >
                        {candidate}
                      </Button>
                    ))}
                  </>
                ) : (
                  <span className="text-muted-foreground">not offered on this account</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {account.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              P-Trades will stop this connection and remove it from your broker-connection provider.
              Your broker account itself is untouched, and everything already recorded in P-Trades
              is kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {disconnectError ? (
            <p className="rounded-sm border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              {disconnectError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDisconnectError(null)}>
              Keep connected
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                disconnectMutation.mutate({ force: disconnectError !== null });
              }}
              disabled={disconnectMutation.isPending}
            >
              {disconnectError ? "Disconnect anyway" : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate font-medium">{value}</dd>
    </div>
  );
}

/**
 * Research consent is a separate, optional decision. Switching it on never
 * arms execution and switching it off stops only future evidence inclusion.
 */
function ResearchConsentSection({
  account,
  onChanged,
}: {
  account: ConnectedAccountView;
  onChanged: () => void;
}) {
  const save = useServerFn(setAccountResearchConsent);
  const [pending, setPending] = useState<boolean | null>(null);
  const mutation = useMutation({
    mutationFn: (enabled: boolean) => save({ data: { accountId: account.id, enabled } }),
    onSuccess: (result) => {
      setPending(null);
      toast.success(
        result.enabled
          ? "Pooled research consent recorded."
          : "Research consent withdrawn for future evidence.",
      );
      onChanged();
    },
    onError: (err: Error) => {
      setPending(null);
      toast.error(err.message);
    },
  });

  return (
    <div className="border-t border-border p-3 text-xs">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium">Optional pooled research</p>
          <p className="mt-1 max-w-2xl text-muted-foreground">
            Allow future positively associated broker evidence from this account to contribute to
            grouped P-Trades research under a random pseudonymous reference. Your broker login,
            MetaApi account id and identity are never exposed on research surfaces. This does not
            affect signals, orders, your journal or your Performance sources.
          </p>
        </div>
        <Switch
          checked={account.researchConsent.current}
          disabled={mutation.isPending}
          aria-label="Allow future broker evidence in pooled research"
          onCheckedChange={(enabled) => setPending(enabled)}
        />
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {account.researchConsent.current
          ? `Consent version ${account.researchConsent.version} recorded ${new Date(account.researchConsent.updatedAt as string).toUTCString()}. You can withdraw at any time; withdrawal stops future pooling and does not rewrite evidence already collected with consent.`
          : account.researchConsent.updatedAt
            ? `Not participating. Your latest decision was recorded ${new Date(account.researchConsent.updatedAt).toUTCString()}.`
            : "Not participating — consent defaults to off."}
      </p>

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending ? "Consent to optional pooled research?" : "Withdraw research consent?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending
                ? "Only future broker evidence that P-Trades can positively associate with its own orders may be included, under a random pseudonymous reference. Participation is optional and has no effect on service or execution."
                : "Future broker evidence from this account will stop entering pooled research immediately. Evidence already collected under valid consent remains historically accurate and is not rewritten."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={mutation.isPending}
              onClick={() => pending !== null && mutation.mutate(pending)}
            >
              {pending ? "I consent" : "Withdraw consent"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Automatic orders for ONE account.
 *
 * Two independent gates are shown honestly and separately: what the BROKER
 * permits on this account (`offerableModes`, derived server-side from the
 * broker's own facts) and whether the matching capability is switched on
 * system-wide right now. Arming needs both, and the confirmation dialog states
 * exactly what the trader is authorising before anything is saved.
 */
function ArmingSection({
  account,
  onChanged,
}: {
  account: ConnectedAccountView;
  onChanged: () => void;
}) {
  const setMode = useServerFn(setBrokerAccountMode);
  const controls = useQuery({
    queryKey: ["execution-status"],
    queryFn: () => getExecutionStatus(),
  });
  const [pending, setPending] = useState<AccountMode | null>(null);

  const mutation = useMutation({
    mutationFn: (mode: AccountMode) => setMode({ data: { accountId: account.id, mode } }),
    onSuccess: (_result, mode) => {
      setPending(null);
      toast.success(
        mode === "observe"
          ? "This account is back in observe mode. P-Trades will not place orders on it."
          : `${MODE_LABELS[mode]} is armed for this account.`,
      );
      onChanged();
    },
    onError: (err: Error) => {
      setPending(null);
      toast.error(err.message);
    },
  });

  const capabilityFor = (mode: AccountMode): string | null => {
    if (mode === "observe" || !controls.data) return null;
    if (mode === "demo_auto" && !controls.data.demoAutoEnabled) {
      return "Demo auto-execution is switched off system-wide right now.";
    }
    if ((mode === "live_auto" || mode === "live_confirm") && !controls.data.liveEnabled) {
      return "Live execution is switched off system-wide.";
    }
    if (mode === "live_auto" && !controls.data.liveAutoEnabled) {
      return "Live auto-execution is switched off system-wide.";
    }
    return null;
  };

  const options = account.offerableModes;

  return (
    <div className="border-t border-border p-3 text-xs">
      <p className="font-medium">Automatic orders</p>
      <p className="mt-1 text-muted-foreground">{MODE_NOTES[account.mode]}</p>

      {options.length === 1 ? (
        <p className="mt-2 text-muted-foreground">
          {account.armRefusal
            ? `Automatic orders are not available on this account: ${account.armRefusal}.`
            : "Automatic orders are not available on this account."}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {options.map((mode) => {
            const blocked = capabilityFor(mode);
            const current = account.mode === mode;
            return (
              <Button
                key={mode}
                size="sm"
                variant={current ? "default" : "outline"}
                disabled={current || mutation.isPending || blocked !== null}
                title={blocked ?? undefined}
                onClick={() => setPending(mode)}
              >
                {current ? <CheckCircle2 className="size-4" /> : null}
                {MODE_LABELS[mode]}
              </Button>
            );
          })}
        </div>
      )}

      {options
        .map((mode) => ({ mode, blocked: capabilityFor(mode) }))
        .filter((entry) => entry.blocked !== null)
        .map((entry) => (
          <p key={entry.mode} className="mt-1 text-muted-foreground">
            {MODE_LABELS[entry.mode]}: {entry.blocked}
          </p>
        ))}

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending === "observe"
                ? `Return ${account.label} to observe mode?`
                : `Arm ${pending ? MODE_LABELS[pending] : ""} on ${account.label}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending ? MODE_NOTES[pending] : null}
              {pending && pending !== "observe"
                ? " Every order is still sized from your broker's own equity and specification at the moment it is sent, and is abandoned rather than resized if any of that is missing."
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={mutation.isPending}
              onClick={() => pending && mutation.mutate(pending)}
            >
              {pending === "observe" ? "Stand down" : "I authorise this"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * The owner's account-wide boundary on how many broker positions/orders may be
 * open at once. It is checked against the BROKER at submission time and fails
 * closed if the broker cannot be read, so it never becomes a claim about broker
 * state here.
 */
function ExposureSection({
  account,
  onChanged,
}: {
  account: ConnectedAccountView;
  onChanged: () => void;
}) {
  const save = useServerFn(setAccountExposureBoundary);
  const [value, setValue] = useState(
    account.maxAccountOpenPositions === null ? "" : String(account.maxAccountOpenPositions),
  );

  const mutation = useMutation({
    mutationFn: () => {
      const trimmed = value.trim();
      const parsed = trimmed === "" ? null : Number(trimmed);
      return save({ data: { accountId: account.id, maxOpenPositions: parsed } });
    },
    onSuccess: () => {
      toast.success("Exposure boundary saved.");
      onChanged();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="border-t border-border p-3 text-xs">
      <p className="font-medium">Account exposure boundary</p>
      <p className="mt-1 text-muted-foreground">
        The most simultaneous positions and pending orders P-Trades may leave open on this broker
        account. Leave it empty for no boundary. Before each order P-Trades reads your
        broker&rsquo;s own open positions — if your broker cannot be read, the order is abandoned
        rather than sent on an assumption.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Label htmlFor={`exposure-${account.id}`} className="sr-only">
          Maximum simultaneous broker positions
        </Label>
        <Input
          id={`exposure-${account.id}`}
          inputMode="numeric"
          className="num h-8 w-24"
          placeholder="no limit"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          Save boundary
        </Button>
      </div>
    </div>
  );
}
