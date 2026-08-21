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
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ConnectPage,
});

const SERVER_SLUG = "p-trades-hub";

function useMcpUrl() {
  const [url, setUrl] = useState("");
  useEffect(() => {
    setUrl(new URL("/mcp", window.location.origin).toString());
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
  const claudeAdd = `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=${encodeURIComponent(
    "P-Trades Hub",
  )}&connectorUrl=${encodeURIComponent(mcpUrl)}`;
  const claudeCodeCmd = `claude mcp add --scope user --transport http ${SERVER_SLUG} '${mcpUrl.replace(/'/g, "'\\''")}'`;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-4xl items-center px-4">
          <Link to="/" className="flex items-center gap-2">
            <img src={ptradesMark.url} alt="P-Trades Hub logo" width={28} height={28} className="size-7" />
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
          Once connected, your assistant can read live scanner setups, check scanner health, log the trades you
          take or skip, and summarise your R-multiple performance — all as you, using your own sign-in.
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
            You'll be asked to sign in and approve the connection the first time an assistant uses it.
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

            <TabsContent value="chatgpt" className="rounded-md border border-border bg-card p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-foreground">ChatGPT</h3>
              <Steps
                items={[
                  <>
                    Open{" "}
                    <Ext href="https://chatgpt.com/#settings/Connectors/Advanced">ChatGPT Apps settings</Ext> and
                    turn on Developer mode (read the risk notice shown there). If it isn't available, ask a ChatGPT
                    admin to enable it.
                  </>,
                  <>
                    Open the{" "}
                    <Ext href="https://chatgpt.com/plugins#settings/Connectors?create-connector=true&redirectAfter=%2Fplugins">
                      New plugin dialog
                    </Ext>
                    .
                  </>,
                  <>
                    Enter <strong className="text-foreground">P-Trades Hub</strong> as the name and paste the server
                    URL above into the URL field.
                  </>,
                  <>
                    Review the details, tick “I understand and want to continue” (ChatGPT shows this for every
                    custom server), then click <strong className="text-foreground">Create</strong>.
                  </>,
                  <>Enable P-Trades Hub from the chat composer, then ask ChatGPT to use it.</>,
                ]}
              />
            </TabsContent>

            <TabsContent value="claude" className="rounded-md border border-border bg-card p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-foreground">Claude</h3>
              <Steps
                items={[
                  <>
                    Open the <Ext href={claudeAdd}>prefilled custom connector dialog</Ext> in Claude.
                  </>,
                  <>
                    Review the name and URL, then click <strong className="text-foreground">Add</strong>.
                  </>,
                  <>
                    If the prefilled form doesn't open, go to Claude's Connectors page, choose “Add custom
                    connector”, name it P-Trades Hub and paste the server URL above.
                  </>,
                  <>Enable the connector from the chat composer, then ask Claude to use it.</>,
                ]}
              />
            </TabsContent>

            <TabsContent value="claude-code" className="rounded-md border border-border bg-card p-4 sm:p-5">
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
                    Start Claude Code and run <code className="num">/mcp</code> to confirm P-Trades Hub is
                    connected, signing in from that menu when prompted.
                  </>,
                  <>Ask Claude Code to use P-Trades Hub.</>,
                ]}
              />
            </TabsContent>

            <TabsContent value="other" className="rounded-md border border-border bg-card p-4 sm:p-5">
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
            Assistants cache what P-Trades Hub can do. After an update, refresh the connection so it picks up the
            latest capabilities.
          </p>
          <Tabs defaultValue="r-chatgpt" className="mt-4">
            <TabsList className="flex h-auto flex-wrap justify-start gap-1">
              <TabsTrigger value="r-chatgpt">ChatGPT</TabsTrigger>
              <TabsTrigger value="r-claude">Claude</TabsTrigger>
              <TabsTrigger value="r-claude-code">Claude Code</TabsTrigger>
              <TabsTrigger value="r-other">Other clients</TabsTrigger>
            </TabsList>

            <TabsContent value="r-chatgpt" className="rounded-md border border-border bg-card p-4 sm:p-5">
              <Steps
                items={[
                  <>Open ChatGPT's Plugins page and select P-Trades Hub.</>,
                  <>
                    Scroll to “Information” and click <strong className="text-foreground">Refresh</strong>.
                  </>,
                  <>
                    ChatGPT can't change an existing app's URL — if the URL above changed, delete the app and
                    connect again.
                  </>,
                  <>Start a new chat and ask ChatGPT to use P-Trades Hub.</>,
                ]}
              />
            </TabsContent>

            <TabsContent value="r-claude" className="rounded-md border border-border bg-card p-4 sm:p-5">
              <Steps
                items={[
                  <>Open Claude's Connectors page and select P-Trades Hub.</>,
                  <>Refresh or update the connector.</>,
                  <>
                    Claude can't change an existing connector's URL — if the URL above changed, remove the
                    connector and connect again.
                  </>,
                  <>Ask Claude to use P-Trades Hub.</>,
                ]}
              />
            </TabsContent>

            <TabsContent value="r-claude-code" className="rounded-md border border-border bg-card p-4 sm:p-5">
              <Steps
                items={[
                  <>Start a new Claude Code session — it loads the latest capabilities on connect.</>,
                  <>
                    If the URL above changed, run <code className="num">claude mcp remove {SERVER_SLUG}</code>,
                    then run the install command again.
                  </>,
                  <>Ask Claude Code to use P-Trades Hub.</>,
                ]}
              />
            </TabsContent>

            <TabsContent value="r-other" className="rounded-md border border-border bg-card p-4 sm:p-5">
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
