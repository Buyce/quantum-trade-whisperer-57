/**
 * [INVARIANT] Documentation-contract gate.
 *
 * These tests assert semantic properties of the canonical documentation, the
 * user-facing copy and the agent-facing MCP strings. They exist because prose
 * drifts silently: nothing else in the suite notices when a doc starts calling a
 * self-reported price broker-verified, keeps a stale preview URL as production,
 * or claims that an empty signal list proves no valid setup exists.
 *
 * Scope: canonical docs (`README.md`, `docs/**`), `AGENTS.md`, the routes map and
 * the routes that carry user copy. `.lovable/plan/**` is a historical record and
 * is deliberately excluded.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INSTRUMENTS, TIMEFRAMES } from "@/lib/scanner/types";
import { DEFAULT_EXECUTION_POLICY } from "@/lib/delivery/execution";

const ROOT = process.cwd();
const CANONICAL_URL = "https://getptrades.com";

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** Every markdown file under `docs/`, at any depth (so `docs/audits/**` counts). */
function markdownUnder(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? markdownUnder(`${dir}/${e.name}`)
      : e.name.endsWith(".md")
        ? [`${dir}/${e.name}`]
        : [],
  );
}

const DOC_FILES = ["README.md", "AGENTS.md", ...markdownUnder("docs")];

const DOCS = DOC_FILES.map((rel) => ({ rel, text: read(rel) }));

/**
 * Dated audit snapshots are frozen evidence for a named checkout. Truthfulness
 * gates (no credentials, no preview host as production) still apply to them, but
 * the feature-reference structure does not: retrofitting headings onto a
 * historical record would misrepresent what was actually observed.
 */
const DATED_AUDITS = DOC_FILES.filter((rel) => rel.startsWith("docs/audits/"));

/** Documents that carry the full feature-reference contract. */
const FEATURE_REFERENCES = DOC_FILES.filter(
  (rel) =>
    rel.startsWith("docs/") &&
    !DATED_AUDITS.includes(rel) &&
    !["docs/README.md", "docs/LINK-AUDIT.md"].includes(rel),
);


describe("documentation contract: URLs", () => {
  it("[INVARIANT] names the canonical production URL in the README", () => {
    expect(read("README.md")).toContain(CANONICAL_URL);
  });

  it("[INVARIANT] never presents a lovable.app preview URL as the production app", () => {
    for (const { rel, text } of DOCS) {
      expect(text, `${rel} must not cite a preview host as production`).not.toMatch(
        /https:\/\/[a-z0-9-]*lovable\.app/i,
      );
    }
  });

  it("[INVARIANT] uses the canonical host in robots.txt and the sitemap route", () => {
    expect(read("public/robots.txt")).toContain(`${CANONICAL_URL}/sitemap.xml`);
    expect(read("src/routes/sitemap[.]xml.ts")).toContain(`"${CANONICAL_URL}"`);
  });

  it("[INVARIANT] keeps the authenticated guide out of the sitemap", () => {
    expect(read("src/routes/sitemap[.]xml.ts")).not.toContain("/guide");
  });

  it("[INVARIANT] marks the authenticated guide noindex", () => {
    expect(read("src/routes/_authenticated/guide.tsx")).toContain("noindex");
  });
});

describe("documentation contract: no credentials", () => {
  // The original build prompt carried live broker identifiers (account id, trading
  // login, provider user id). They must never reappear in canonical docs, and this
  // gate must not embed them either: the login is matched contextually and via a
  // one-way digest, never as a literal.
  const FORBIDDEN_LOGIN_SHA256 = "f3de62b01786cba93b8f1379504fa5ee9274de707643cb3e4ad1c4de7328aecf";

  it("[INVARIANT] contains no UUID-shaped account identifiers or broker login numbers", () => {
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    // Contextual detector: a long digit run presented as an account/login/server
    // credential, in any order, is a credential leak regardless of its value.
    const contextualLogin =
      /\b(?:account|login|acct|mt[45])\b[^.\n]{0,40}?\b\d{6,}\b|\b\d{6,}\b[^.\n]{0,40}?\b(?:account|login)\b/i;
    for (const { rel, text } of DOCS) {
      // The Lovable editor deep link legitimately carries the project id; it is
      // not a broker or account credential.
      const scrubbed = text.replace(/https:\/\/lovable\.dev\/projects\/[0-9a-f-]+/gi, "");
      expect(scrubbed, `${rel} must not contain a UUID-shaped identifier`).not.toMatch(uuid);
      expect(scrubbed, `${rel} must not present a numeric account/login credential`).not.toMatch(
        contextualLogin,
      );
      for (const digits of scrubbed.match(/\b\d{6,}\b/g) ?? []) {
        expect(
          createHash("sha256").update(digits).digest("hex"),
          `${rel} must not contain the historical broker login`,
        ).not.toBe(FORBIDDEN_LOGIN_SHA256);
      }
      expect(text, `${rel} must not contain a bearer/JWT-shaped token`).not.toMatch(
        /\beyJ[A-Za-z0-9_-]{10,}/,
      );
    }
  });
});

describe("documentation contract: guide matches the History route", () => {
  it("[INVARIANT] the guide never claims Trade History shows skipped setups", () => {
    const guide = read("src/routes/_authenticated/guide.tsx");
    const history = read("src/routes/_authenticated/history.tsx");
    // The route is taken-only; the guide must not contradict it.
    expect(history).toContain("takenTradeHistoryQuery");
    expect(guide, "guide must not say History includes skipped trades").not.toMatch(
      /History[^.\n]{0,120}includ\w*[^.\n]{0,40}skipped/i,
    );
    expect(guide).toMatch(/skipped[^.\n]{0,120}do not appear/i);
  });
});

describe("documentation contract: internal links resolve", () => {
  it("[INVARIANT] every relative markdown link points at a file that exists", () => {
    const link = /\]\((?!https?:|mailto:|#)([^)\s#]+)/g;
    for (const { rel, text } of DOCS) {
      const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : ".";
      for (const m of text.matchAll(link)) {
        const target = m[1]!;
        const abs = target.startsWith("/") ? join(ROOT, target.slice(1)) : join(ROOT, dir, target);
        expect(existsSync(abs), `${rel} links to missing ${target}`).toBe(true);
      }
    }
  });
});

describe("documentation contract: empty results", () => {
  const EMPTY_CLAIM =
    /(no valid setup|no trade)[^.\n]{0,80}(because|means|proves)[^.\n]{0,80}(empty|no rows|zero rows)/i;

  it("[INVARIANT] never equates an empty list_signals result with 'no valid setup'", () => {
    const sources = [
      ...DOCS,
      { rel: "src/lib/mcp/index.ts", text: read("src/lib/mcp/index.ts") },
      { rel: "src/lib/mcp/tools/list-signals.ts", text: read("src/lib/mcp/tools/list-signals.ts") },
      { rel: ".lovable/mcp/manifest.json", text: read(".lovable/mcp/manifest.json") },
    ];
    for (const { rel, text } of sources) {
      expect(text, `${rel} must not treat emptiness as proof`).not.toMatch(EMPTY_CLAIM);
    }
  });

  it("[INVARIANT] the list_signals description states that emptiness is filter-scoped", () => {
    const text = read(".lovable/mcp/manifest.json");
    expect(text).toMatch(/empty result means nothing matched the requested filters/i);
  });

  it("[INVARIANT] no doc claims a filtered empty view proves capital preservation", () => {
    for (const { rel, text } of DOCS) {
      const lines = text.split("\n");
      const qualifier =
        /unfiltered|current[- ]cycle|scanner[- ]wide|never|not |only |may not|must not|stale|historical/i;
      lines.forEach((line, i) => {
        if (!/capital preservation/i.test(line)) return;
        // Any surviving mention must be qualified as unfiltered / current-cycle,
        // or explicitly marked as the stale claim being corrected. The qualifier
        // may sit in the neighbouring lines of the same sentence.
        const window = lines.slice(Math.max(0, i - 2), i + 3).join(" ");
        expect(
          qualifier.test(window),
          `${rel} has an unqualified Capital Preservation claim: ${line.trim()}`,
        ).toBe(true);
      });
    }
  });

  it("[INVARIANT] the capped Feed empty state is view-scoped and points to health", () => {
    const feed = read("src/routes/_authenticated/feed.tsx");
    expect(feed).toContain("NO SETUPS IN THIS VIEW");
    expect(feed).toMatch(/not a scanner-wide No Trade claim/i);
    expect(feed).toMatch(/heartbeat[^.]{0,80}scanner-health authority/i);
    expect(feed).not.toContain("CAPITAL PRESERVATION MODE");
  });
});

describe("documentation contract: provenance wording", () => {
  it("[INVARIANT] never calls self-reported prices broker verified", () => {
    const bad = /self[- ]reported[^.\n]{0,60}broker[- ]verified/i;
    for (const { rel, text } of DOCS) {
      expect(text, `${rel} conflates self-reported with broker-verified`).not.toMatch(bad);
    }
  });

  it("[INVARIANT] never calls a margin figure broker-exact", () => {
    for (const { rel, text } of DOCS) {
      // A prohibition ("never call margin broker-exact") is not a violation.
      const claims = text
        .split("\n")
        .filter((l) => !/\b(never|not|must not|avoid|do not)\b/i.test(l))
        .join("\n");
      expect(claims, `${rel} calls margin broker-exact`).not.toMatch(
        /margin[^.\n]{0,40}broker[- ](exact|confirmed|accurate)/i,
      );
    }
  });

  it("[INVARIANT] documents margin as an estimate", () => {
    expect(read("docs/RISK-SIZING.md")).toMatch(/margin[^.\n]{0,40}estimate/i);
  });
});

describe("documentation contract: replay and learning claims", () => {
  it("[INVARIANT] names frozen Replay V1 and corrected research Replay V2 separately", () => {
    const research = read("docs/RESEARCH-AND-SHADOW.md");
    expect(research).toContain("legacy_best_target_touched");
    expect(research).toContain("single_exit_first_target");
    expect(research).toMatch(/credits the[^.]{0,40}deepest/i);
    expect(research).toContain("is the corrected research labeller");
  });

  it("[INVARIANT] presents the replay joint statistic as descriptive, not a forecast", () => {
    const signalCard = read("src/components/SignalCard.tsx");
    const feed = read("src/routes/_authenticated/feed.tsx");
    expect(signalCard).toContain("Replay joint rate");
    expect(signalCard).toMatch(/not a forecast/i);
    expect(feed).toContain("replay joint rate");
    expect(feed).toMatch(/descriptive, not a forecast/i);
    expect(signalCard).not.toContain("Est. joint win prob.");
  });
});

describe("documentation contract: active V1 scanner claims", () => {
  it("[INVARIANT] discloses V1 Point-C, grade and barrier limitations", () => {
    const guide = read("src/routes/_authenticated/guide.tsx");
    const signals = read("docs/SIGNALS-AND-GRADES.md");
    expect(guide).toMatch(/active V1 scanner/i);
    expect(guide).toMatch(/latest six M15 candles/i);
    expect(guide).toMatch(/not a validated mean-reversion setup/i);
    expect(signals).toMatch(/two Point-C concepts/i);
    expect(signals).toMatch(/does not require the H4 barrier condition/i);
    expect(signals).toMatch(/unbroken-swing measure[^.]{0,160}different barriers/i);
  });

  it("[INVARIANT] does not relabel an OHLC zone heuristic as institutional order flow", () => {
    expect(read("docs/SIGNALS-AND-GRADES.md")).toMatch(
      /not evidence of institutional orders or order\s+flow/i,
    );
    expect(read("src/routes/_authenticated/settings.tsx")).not.toMatch(
      /full institutional confluence/i,
    );
  });
});

describe("documentation contract: learning and MCP claims", () => {
  it("[INVARIANT] presents replay rates as descriptive rather than predictive", () => {
    const intelligenceTool = read("src/lib/mcp/tools/get-intelligence.ts");
    const mcp = read("src/lib/mcp/index.ts");
    const admin = read("src/routes/_authenticated/admin/intelligence.tsx");

    expect(intelligenceTool).toContain("joint_replay_rate");
    expect(intelligenceTool).toMatch(/not forecasts, expected return or a live track record/i);
    expect(mcp).toMatch(/descriptive in-sample replay rates/i);
    expect(mcp).not.toMatch(/Everything is live broker-derived/i);
    expect(admin).not.toMatch(/Bayesian learning monitor/i);
  });
});

describe("documentation contract: ChatGPT developer mode instructions", () => {
  const CONNECT = "src/routes/connect.tsx";
  /** Collapse JSX line wrapping so prose assertions are not layout-sensitive. */
  const flat = (text: string) => text.replace(/\s+/g, " ");

  it("[INVARIANT] uses OpenAI's current Settings → Security and login path", () => {
    expect(read(CONNECT)).toMatch(/Security and login/i);
  });

  it("[INVARIANT] documents every currently supported web plan family", () => {
    const text = flat(read(CONNECT));
    expect(text).toMatch(/Pro, Plus, Business, Enterprise and Education/i);
  });

  it("[INVARIANT] accurately states that current developer mode supports read and write tools", () => {
    const text = flat(read(CONNECT));
    expect(text).toMatch(/full MCP client support for read and write tools/i);
    expect(text).toMatch(/Pro, Plus/i);
  });

  it("[INVARIANT] documents the current developer-mode app access path", () => {
    const text = read(CONNECT);
    expect(text).toMatch(/Security and login/i);
    expect(text).toMatch(/ChatGPT Plugins/i);
    expect(text).toMatch(/Drafts/i);
  });

  it("[INVARIANT] documents OAuth, tool review and app creation", () => {
    const text = flat(read(CONNECT));
    expect(text).toMatch(/OAuth/i);
    expect(text).toMatch(/authentication/i);
    expect(text).toMatch(/review the discovered tools/i);
    expect(text).toMatch(/create the app/i);
  });

  it("[INVARIANT] does not use chatgpt.com/plugins as the setup path", () => {
    expect(read(CONNECT)).not.toContain("chatgpt.com/plugins");
  });

  it("[INVARIANT] states that write actions require confirmation by default", () => {
    expect(flat(read(CONNECT))).toMatch(/write actions require confirmation by default/i);
  });

  it("[INVARIANT] keeps the official OpenAI developer guide authoritative and notes change", () => {
    const text = read(CONNECT);
    expect(text).toContain("developers.openai.com/api/docs/guides/developer-mode");
    expect(text).toMatch(/If a step does not match what you see/i);
  });

  it("[INVARIANT] keeps the write-tool availability caveat", () => {
    const text = read(CONNECT);
    expect(text).toMatch(/update_my_settings/);
    expect(flat(text)).toMatch(/availability still depends on your account/i);
    expect(flat(text)).toMatch(/managed workspaces[^.]{0,80}administrator policy/i);
  });
});

describe("documentation contract: code constants", () => {
  it("[INVARIANT] the documented execution policy matches the code constant", () => {
    expect(read("docs/EXECUTION.md")).toContain(DEFAULT_EXECUTION_POLICY);
  });

  it("[INVARIANT] the documented instruments match INSTRUMENTS", () => {
    const scanner = read("docs/SCANNER.md");
    for (const instrument of INSTRUMENTS) {
      expect(scanner, `SCANNER.md omits ${instrument}`).toContain(instrument);
    }
  });

  it("[INVARIANT] the documented timeframes match TIMEFRAMES", () => {
    const scanner = read("docs/SCANNER.md");
    for (const tf of TIMEFRAMES) {
      expect(scanner, `SCANNER.md omits ${tf}`).toContain(tf);
    }
  });

  it("[INVARIANT] every MCP tool name in the manifest is documented in MCP.md", () => {
    const manifest = JSON.parse(read(".lovable/mcp/manifest.json")) as {
      mcp: { tools: { name: string }[] };
    };
    const names = manifest.mcp.tools.map((t) => t.name);
    expect(names.length).toBeGreaterThan(0);
    const doc = read("docs/MCP.md");
    for (const name of names) {
      expect(doc, `MCP.md omits ${name}`).toContain(name);
    }
  });

  it("[INVARIANT] the manifest tool set matches the registered server tools", () => {
    const manifest = JSON.parse(read(".lovable/mcp/manifest.json")) as {
      mcp: { tools: { name: string }[] };
    };
    const manifestNames = [...manifest.mcp.tools.map((t) => t.name)].sort();
    const registered = readdirSync(join(ROOT, "src/lib/mcp/tools"))
      .filter((f) => f.endsWith(".ts"))
      .map((f) => f.replace(/\.ts$/, "").replace(/-/g, "_"))
      .sort();
    expect(manifestNames).toEqual(registered);
  });
});
