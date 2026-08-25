import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ptradesMark from "@/assets/ptrades-mark.png.asset.json";

export const Route = createFileRoute("/connect")({
  head: () => ({
    meta: [
      { title: "Connect an AI Assistant — P-Trades Hub" },
      {
        name: "description",
        content:
          "Step-by-step instructions to connect ChatGPT, Claude, Claude Code or any MCP client to your P-Trades Hub terminal.",
      },
      { property: "og:title", content: "Connect an AI Assistant — P-Trades Hub" },
      {
        property: "og:description",
        content:
          "Paste the P-Trades Hub server URL into ChatGPT, Claude or Claude Code and let your assistant read live scanner setups and your trade journal.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://getptrades.com/connect" },
      // `summary`, not `summary_large_image`: this page ships no absolute social
      // image, and declaring a large card without one degrades the preview.
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://getptrades.com/connect" }],
  }),

  component: ConnectPage,
});

const SERVER_SLUG = "p-trades-hub";

const TOOL_ROWS: [string, string][] = [
  [
    "list_signals",
    "Published scanner setups with entry, stop, targets, R:R and confidence. An empty list means only that nothing matched the requested filters and scope — never that the scanner found no valid setup.",
  ],
  ["get_scanner_status", "Scan engine health, last run, and your active filters."],
  [
    "get_market_status",
    "Which FX sessions are open right now and per-instrument broker feed health.",
  ],
  ["get_my_settings", "Your instruments, sessions, alert grade, daily cap and risk profile."],
  [
    "update_my_settings",
    "Change those preferences. Values are clamped to safe bounds server-side.",
  ],
  [
    "calculate_position_size",
    "Lot size, cash risk and an estimated margin requirement for a setup, using your saved equity and risk percent. Margin is an estimate from the contract specification and your leverage, not a broker quote.",
  ],
  [
    "get_intelligence",
    "In-sample regime replay summaries: hierarchically shrunk fill, TP1-if-filled and joint rates, sample sizes, reporting-gate status and descriptive feature associations. Not a forecast, expected return or live track record.",
  ],
  [
    "get_shadow_comparison",
    "Weekly Replay-V1 comparison of A+/A against B/C, with sample sizes and diagnostic uncertainty. In-sample replay only — not broker performance, prediction or a placed order.",
  ],
  ["log_trade_decision", "Record that you took or skipped a signal."],
  [
    "update_trade_outcome",
    "Set the outcome and, with real entry/exit prices, get self-reported R values computed server-side (never broker verified). Agent-written prices are permanently stamped as agent-entered and attributed to the assistant.",
  ],
  [
    "list_my_trades",
    "Your journal entries, price-backed and price-missing, including who entered each self-reported price.",
  ],
  ["get_performance_summary", "Your expectancy and R-multiple performance."],
];

function useMcpUrl() {
  const [url, setUrl] = useState("");
  useEffect(() => {
    setUrl(new URL("/mcp", window.location.origin).toString());
  }, []);
  return url;
}

function useRegisterUrl() {
  const [url, setUrl] = useState("");
  useEffect(() => {
    setUrl(new URL("/api/public/agent/register", window.location.origin).toString());
  }, []);
  return url;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-label={label}
      disabled={!value}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        });
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      <span className="ml-1">{copied ? "Copied" : "Copy"}</span>
    </Button>
  );
}

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="mt-3 space-y-2 text-sm leading-relaxed text-muted-foreground">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span className="num mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm bg-secondary text-[11px] text-foreground">
            {i + 1}
          </span>
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ol>
  );
}

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-primary underline underline-offset-2"
    >
      {children}
      <ExternalLink className="size-3" />
    </a>
  );
}

function ConnectPage() {
  const mcpUrl = useMcpUrl();
  const registerUrl = useRegisterUrl();
  // No copyable registration command lives on this page any more: the guided
  // flow sends people to /auth so a password is never typed into an assistant.

  const claudeAdd = `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=${encodeURIComponent(
    "P-Trades Hub",
  )}&connectorUrl=${encodeURIComponent(mcpUrl)}`;
  const claudeCodeCmd = `claude mcp add --scope user --transport http ${SERVER_SLUG} '${mcpUrl.replace(/'/g, "'\\''")}'`;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-4xl items-center px-4">
          <Link to="/" className="flex items-center gap-2">
            <img
              src={ptradesMark.url}
              alt="P-Trades Hub logo"
              width={28}
              height={28}
              className="size-7"
            />
            <span className="num text-sm font-semibold">P-TRADES HUB</span>
          </Link>
          <div className="ml-auto">
            <Button asChild size="sm" variant="outline">
              <Link to="/feed">Open terminal</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10 sm:py-14">
        <p className="label-xs">Agent integrations</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          Connect an AI assistant to P-Trades Hub
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
          Once connected, your assistant can read live scanner setups, check scanner and session
          status, size a setup against your risk profile, read the learning engine's regime
          statistics, adjust your own settings, and maintain your trade journal — all as you, using
          your own sign-in.
        </p>

        <section className="mt-8 rounded-md border border-border bg-card p-4 sm:p-5">
          <h2 className="label-xs">Your server URL</h2>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <code className="num min-w-0 flex-1 truncate rounded-sm bg-secondary px-3 py-2 text-sm text-foreground">
              {mcpUrl || "Loading…"}
            </code>
            <CopyButton value={mcpUrl} label="Copy server URL" />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            You'll be asked to sign in and approve the connection the first time an assistant uses
            it.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold text-foreground">What your assistant can do</h2>
          <div className="mt-3 overflow-hidden rounded-md border border-border">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                {TOOL_ROWS.map(([tool, what]) => (
                  <tr key={tool} className="bg-card align-top">
                    <td className="num w-[42%] px-3 py-2 text-xs text-foreground sm:w-[34%] sm:text-sm">
                      {tool}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground sm:text-sm">{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Off-limits to assistants by design: webhook credentials, other users' data, admin
            intelligence, and deleting your account or journal.
          </p>
        </section>

        <section className="mt-10 rounded-md border border-border bg-card p-4 sm:p-5">
          <h2 className="text-lg font-semibold text-foreground">No account yet?</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Create it yourself, in your own browser — it takes a minute and your password never
            leaves your hands. An assistant cannot connect until an account exists and its
            confirmation email has been clicked by whoever owns the inbox.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button asChild>
              <Link to="/auth" search={{ mode: "signup" }}>
                Create an account
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/auth">Sign in</Link>
            </Button>
          </div>
          <Steps
            items={[
              <>Create the account and set your own password here, not in a chat window.</>,
              <>Click the confirmation link we email you.</>,
              <>
                Then connect the server URL above from your assistant and approve the consent
                screen.
              </>,
            ]}
          />
          <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
            There is also a public HTTPS registration endpoint (
            <span className="num">POST {registerUrl || "/api/public/agent/register"}</span>) that
            sits outside the authenticated MCP connection, for scripted setups. It is deliberately
            not part of the guided flow: using it means typing your chosen password into an
            assistant that will transmit it on your behalf, and we would rather you did not. It
            still requires email confirmation and grants nothing until you sign in.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold text-foreground">Connect your assistant</h2>
          <Tabs defaultValue="chatgpt" className="mt-4">
            <TabsList className="flex h-auto flex-wrap justify-start gap-1">
              <TabsTrigger value="chatgpt">ChatGPT</TabsTrigger>
              <TabsTrigger value="claude">Claude</TabsTrigger>
              <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
              <TabsTrigger value="other">Other clients</TabsTrigger>
            </TabsList>

            <TabsContent
              value="chatgpt"
              className="rounded-md border border-border bg-card p-4 sm:p-5"
            >
              <h3 className="text-sm font-semibold text-foreground">ChatGPT</h3>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Custom MCP servers are connected through ChatGPT developer mode, documented in{" "}
                <Ext href="https://developers.openai.com/api/docs/guides/developer-mode">
                  OpenAI's “ChatGPT developer mode” guide
                </Ext>
                , which is the authoritative source for this page. OpenAI currently documents full
                MCP client support for read and write tools on Pro, Plus, Business, Enterprise and
                Education accounts on the web. P-Trades Hub exposes write tools —{" "}
                <code className="num">update_my_settings</code>,{" "}
                <code className="num">log_trade_decision</code>,{" "}
                <code className="num">update_trade_outcome</code> — so inspect every proposed write
                and its JSON before approving it. Availability still depends on your account and,
                for managed workspaces, administrator policy.
              </p>
              <Steps
                items={[
                  <>
                    On ChatGPT web, open <strong className="text-foreground">Settings</strong> →{" "}
                    <strong className="text-foreground">Security and login</strong>, then turn on{" "}
                    <strong className="text-foreground">Developer mode</strong>. A managed workspace
                    may restrict this setting.
                  </>,
                  <>
                    Open <strong className="text-foreground">ChatGPT Plugins</strong>, select the
                    plus button and create a developer-mode app for a remote MCP server. New apps
                    appear under <strong className="text-foreground">Drafts</strong> in app
                    settings.
                  </>,
                  <>
                    Name it <strong className="text-foreground">P-Trades Hub</strong>, paste the
                    server URL above, and choose <strong className="text-foreground">OAuth</strong>{" "}
                    authentication — P-Trades Hub signs you in with your own account, so no static
                    key is needed.
                  </>,
                  <>
                    Complete P-Trades OAuth, review the discovered tools, then create the app. You
                    can toggle individual tools and refresh their definitions on the app details
                    page.
                  </>,
                  <>
                    In a chat, choose <strong className="text-foreground">Developer mode</strong>{" "}
                    from the plus menu and select P-Trades Hub. Write actions require confirmation
                    by default; review their inputs rather than approving them blindly.
                  </>,
                ]}
              />
              <p className="mt-3 text-xs text-muted-foreground">
                If a step does not match what you see, trust OpenAI's current developer guide linked
                above over this page.
              </p>
            </TabsContent>

            <TabsContent
              value="claude"
              className="rounded-md border border-border bg-card p-4 sm:p-5"
            >
              <h3 className="text-sm font-semibold text-foreground">Claude</h3>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Anthropic documents two different paths in{" "}
                <Ext href="https://support.anthropic.com/en/articles/11175166-about-custom-connectors-remote-mcp">
                  its custom connector guide
                </Ext>
                : individual Pro/Max users add the connector themselves, while on Team and
                Enterprise only an Owner or Primary Owner can add it to the organisation — members
                then connect to it individually with their own P-Trades sign-in.
              </p>
              <h4 className="mt-4 text-xs font-semibold text-foreground">
                Individual Pro or Max plan
              </h4>
              <Steps
                items={[
                  <>
                    Open the <Ext href={claudeAdd}>prefilled custom connector dialog</Ext>, or go to{" "}
                    <strong className="text-foreground">Customize → Connectors</strong> and choose
                    “+” → “Add custom connector”.
                  </>,
                  <>
                    Paste the server URL above as the remote MCP server URL. Leave “Advanced
                    settings” alone — P-Trades Hub needs no OAuth client ID or secret from you.
                  </>,
                  <>
                    Review the name and URL, then click{" "}
                    <strong className="text-foreground">Add</strong>.
                  </>,
                  <>
                    Enable the connector from the “+” button in the chat composer, sign in when
                    prompted, then ask Claude to use it.
                  </>,
                ]}
              />
              <h4 className="mt-4 text-xs font-semibold text-foreground">
                Team or Enterprise plan
              </h4>
              <Steps
                items={[
                  <>
                    An Owner or Primary Owner opens{" "}
                    <strong className="text-foreground">Organization settings → Connectors</strong>,
                    clicks “Add”, hovers “Custom” and selects “Web”.
                  </>,
                  <>
                    They paste the server URL above and finish with{" "}
                    <strong className="text-foreground">Add</strong>.
                  </>,
                  <>
                    Each member then opens{" "}
                    <strong className="text-foreground">Customize → Connectors</strong>, connects to
                    P-Trades Hub and signs in — so every member only ever sees their own data.
                  </>,
                  <>Enable it from the chat composer and ask Claude to use it.</>,
                ]}
              />
              <p className="mt-3 text-xs text-muted-foreground">
                Vendor UI, plan availability and role names can change; Anthropic's guide above is
                authoritative if this page and Claude disagree.
              </p>
            </TabsContent>

            <TabsContent
              value="claude-code"
              className="rounded-md border border-border bg-card p-4 sm:p-5"
            >
              <h3 className="text-sm font-semibold text-foreground">Claude Code</h3>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <pre className="num min-w-0 flex-1 overflow-x-auto rounded-sm bg-secondary px-3 py-2 text-xs text-foreground">
                  {claudeCodeCmd}
                </pre>
                <CopyButton value={claudeCodeCmd} label="Copy install command" />
              </div>
              <Steps
                items={[
                  <>Run the command above in a terminal.</>,
                  <>
                    Start Claude Code and run <code className="num">/mcp</code> to confirm P-Trades
                    Hub is connected, signing in from that menu when prompted.
                  </>,
                  <>Ask Claude Code to use P-Trades Hub.</>,
                ]}
              />
            </TabsContent>

            <TabsContent
              value="other"
              className="rounded-md border border-border bg-card p-4 sm:p-5"
            >
              <h3 className="text-sm font-semibold text-foreground">Other MCP clients</h3>
              <Steps
                items={[
                  <>Open the assistant's MCP server or custom connector settings.</>,
                  <>Create a new remote MCP server connection.</>,
                  <>Name it P-Trades Hub and paste the server URL above.</>,
                  <>Complete any sign-in or authorization prompts.</>,
                  <>Enable the connection, then ask the assistant to use it.</>,
                ]}
              />
            </TabsContent>
          </Tabs>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold text-foreground">Refresh after the app changes</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Assistants cache what P-Trades Hub can do. After an update, refresh the connection so it
            picks up the latest capabilities.
          </p>
          <Tabs defaultValue="r-chatgpt" className="mt-4">
            <TabsList className="flex h-auto flex-wrap justify-start gap-1">
              <TabsTrigger value="r-chatgpt">ChatGPT</TabsTrigger>
              <TabsTrigger value="r-claude">Claude</TabsTrigger>
              <TabsTrigger value="r-claude-code">Claude Code</TabsTrigger>
              <TabsTrigger value="r-other">Other clients</TabsTrigger>
            </TabsList>

            <TabsContent
              value="r-chatgpt"
              className="rounded-md border border-border bg-card p-4 sm:p-5"
            >
              <Steps
                items={[
                  <>
                    Open <strong className="text-foreground">Settings</strong> →{" "}
                    <strong className="text-foreground">Apps</strong> and open the P-Trades Hub
                    app's details page.
                  </>,

                  <>
                    Click <strong className="text-foreground">Refresh</strong> to pull the latest
                    tools, descriptions and server instructions, then check the tool toggles.
                  </>,
                  <>
                    ChatGPT can't change an existing app's URL — if the URL above changed, delete
                    the app and connect again.
                  </>,
                  <>Start a new chat and ask ChatGPT to use P-Trades Hub.</>,
                ]}
              />
            </TabsContent>

            <TabsContent
              value="r-claude"
              className="rounded-md border border-border bg-card p-4 sm:p-5"
            >
              <Steps
                items={[
                  <>
                    Open <strong className="text-foreground">Customize → Connectors</strong> (Team
                    and Enterprise Owners:{" "}
                    <strong className="text-foreground">Organization settings → Connectors</strong>)
                    and select P-Trades Hub.
                  </>,

                  <>Refresh or update the connector.</>,
                  <>
                    Claude can't change an existing connector's URL — if the URL above changed,
                    remove the connector and connect again.
                  </>,
                  <>Ask Claude to use P-Trades Hub.</>,
                ]}
              />
            </TabsContent>

            <TabsContent
              value="r-claude-code"
              className="rounded-md border border-border bg-card p-4 sm:p-5"
            >
              <Steps
                items={[
                  <>
                    Start a new Claude Code session — it loads the latest capabilities on connect.
                  </>,
                  <>
                    If the URL above changed, run{" "}
                    <code className="num">claude mcp remove {SERVER_SLUG}</code>, then run the
                    install command again.
                  </>,
                  <>Ask Claude Code to use P-Trades Hub.</>,
                ]}
              />
            </TabsContent>

            <TabsContent
              value="r-other"
              className="rounded-md border border-border bg-card p-4 sm:p-5"
            >
              <Steps
                items={[
                  <>Open the assistant's MCP server or connector settings.</>,
                  <>Select the P-Trades Hub connection.</>,
                  <>Refresh the connection, reload the server, or reconnect it.</>,
                  <>If the URL above changed, paste the latest one.</>,
                  <>Start a new chat or session and ask the assistant to use P-Trades Hub.</>,
                ]}
              />
            </TabsContent>
          </Tabs>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-4xl px-4 py-8 text-xs text-muted-foreground">
          P-Trades Hub · Analytical tool only. Nothing here is financial advice.
        </div>
      </footer>
    </div>
  );
}
