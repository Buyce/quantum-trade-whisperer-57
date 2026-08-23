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

const DOC_FILES = [
  "README.md",
  "AGENTS.md",
  ...readdirSync(join(ROOT, "docs"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => `docs/${f}`),
];

const DOCS = DOC_FILES.map((rel) => ({ rel, text: read(rel) }));

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

describe("documentation contract: ChatGPT developer mode instructions", () => {
  const CONNECT = "src/routes/connect.tsx";
  /** Collapse JSX line wrapping so prose assertions are not layout-sensitive. */
  const flat = (text: string) => text.replace(/\s+/g, " ");

  it("[INVARIANT] does not use the stale Settings → Security and login path", () => {
    expect(read(CONNECT)).not.toMatch(/Security and login/i);
  });

  it("[INVARIANT] does not claim Plus supports custom MCP developer mode", () => {
    expect(read(CONNECT)).not.toMatch(/\bPlus\b/);
  });

  it("[INVARIANT] does not imply full write MCP on Pro", () => {
    const text = read(CONNECT);
    expect(text).toMatch(/Pro[^.\n]{0,80}read\/fetch/i);
    expect(text).not.toMatch(/Pro,\s*Plus/i);
  });

  it("[INVARIANT] documents the plan-specific developer-access paths", () => {
    const text = read(CONNECT);
    expect(text).toMatch(/Advanced Settings/);
    expect(text).toMatch(/Enterprise\/Edu/);
    expect(text).toMatch(/Business/);
  });

  it("[INVARIANT] documents the Scan Tools → authorization → Create sequence", () => {
    const text = read(CONNECT);
    expect(text).toMatch(/Scan Tools/);
    expect(text).toMatch(/OAuth authorization/i);
    expect(text).toMatch(/wait for the scan/i);
  });

  it("[INVARIANT] does not use chatgpt.com/plugins as the setup path", () => {
    expect(read(CONNECT)).not.toContain("chatgpt.com/plugins");
  });

  it("[INVARIANT] states confirmation depends on permissions, context and risk", () => {
    expect(flat(read(CONNECT))).toMatch(
      /may ask for confirmation before an action depending on permissions, action context and risk/i,
    );
  });

  it("[INVARIANT] keeps the OpenAI Help Center article authoritative and notes change", () => {
    const text = read(CONNECT);
    expect(text).toContain(
      "help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt",
    );
    expect(text).toMatch(/plan availability may change/i);
  });

  it("[INVARIANT] keeps the write-tool availability caveat", () => {
    const text = read(CONNECT);
    expect(text).toMatch(/update_my_settings/);
    expect(flat(text)).toMatch(/availability depends[^.]{0,80}plan and workspace permissions/i);
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
