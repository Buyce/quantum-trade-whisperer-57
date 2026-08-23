import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { GuideDetail } from "@/components/GuideMode";

/**
 * Compact in-terminal version of the /connect page: the two URLs an assistant
 * needs, plus a pointer to the full walkthrough. The origin is read at runtime
 * so preview, published and custom-domain deployments each show their own URL
 * rather than a hardcoded host.
 */
function useOrigin() {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  return origin;
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

function UrlRow({ label, url, hint }: { label: string; url: string; hint: string }) {
  return (
    <div>
      <p className="label-xs">{label}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <code className="num min-w-0 flex-1 truncate rounded-sm bg-secondary px-3 py-2 text-xs text-foreground sm:text-sm">
          {url || "Loading…"}
        </code>
        <CopyButton value={url} label={`Copy ${label.toLowerCase()}`} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

export function AgentConnectCard() {
  const origin = useOrigin();
  const mcpUrl = origin ? `${origin}/mcp` : "";
  const registerUrl = origin ? `${origin}/api/public/agent/register` : "";

  return (
    <section className="space-y-5 rounded-md border border-border bg-card p-4">
      <div>
        <h2 className="label-xs">AI assistants &amp; agents</h2>
        <GuideDetail
          className="mt-2"
          title="What a connected assistant can and cannot do"
          what="An MCP connection that lets ChatGPT, Claude or Claude Code read your setups, scanner and market status, settings, journal and performance, size a position, and log or update trades as you."
          why="It uses the same eligibility rules, the same sizing service and the same R mathematics as this screen, so it cannot be talked into a different number."
          todo="Connect it, then ask it questions about your own data — and check its journal writes, which are permanently stamped as agent-entered."
          assume="It cannot reach your broker, see anyone else's data, enable live execution, change grading or published signals, or retrieve secrets. An empty signal list from it means nothing matched the filters it asked for."
          anchor="ai"
        />
        <p className="mt-2 text-sm text-muted-foreground">
          Paste the server URL below into ChatGPT, Claude, Claude Code or any MCP client. The assistant then acts
          as you, using your own sign-in: it can read live setups, size them against your risk profile, adjust
          these settings and maintain your journal. Prices an assistant writes are permanently marked as
          agent-entered.
        </p>
      </div>

      <UrlRow
        label="Server URL"
        url={mcpUrl}
        hint="You'll be asked to sign in and approve the connection the first time an assistant uses it."
      />

      <UrlRow
        label="Agent registration endpoint"
        url={registerUrl}
        hint="For assistants creating a brand-new account by POSTing an email and password. The confirmation email still has to be clicked."
      />

      <Button asChild variant="outline" size="sm">
        <Link to="/connect">
          Full connection instructions
          <ExternalLink className="ml-1 size-3" />
        </Link>
      </Button>
    </section>
  );
}
