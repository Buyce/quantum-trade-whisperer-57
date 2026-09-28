import { describe, expect, it, vi } from "vitest";
import { ABILITIES } from "@/lib/ai-tools/registry";
import { buildAssistantTools } from "@/lib/assistant/tools";
import { runProposeCancelOrder, runProposeCohortPolicy } from "@/lib/ai-tools/bodies";

vi.mock("@/lib/validation/runtime.server", () => ({ runRuntimeValidation: vi.fn() }));

describe("AI ability registry", () => {
  it("[UNIT] every in_app ability exists as an in-app assistant tool", () => {
    const tools = Object.keys(buildAssistantTools({}, "u"));
    for (const a of ABILITIES.filter((x) => x.surfaces.includes("in_app"))) {
      expect(tools, a.name).toContain(a.name);
    }
  });

  it("[UNIT] every mcp ability is registered on the MCP server", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("src/lib/mcp/index.ts", "utf8") +
      fs.readFileSync("src/lib/mcp/v09.ts", "utf8") +
      fs.readFileSync("src/lib/mcp/v10.ts", "utf8"),
    );
    for (const a of ABILITIES.filter((x) => x.surfaces.includes("mcp"))) {
      const camel = a.name.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
      expect(src.includes(`name: "${a.name}"`) || src.includes(camel), a.name).toBe(true);
    }
  });
});

function fakeDb(row: unknown) {
  const inserts: unknown[] = [];
  const updates: unknown[] = [];
  const chain = (table: string): Record<string, unknown> => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order", "limit", "is"]) q[m] = () => q;
    q["maybeSingle"] = async () => ({ data: row, error: null });
    q["update"] = (v: unknown) => {
      updates.push({ table, v });
      return q;
    };
    q["insert"] = (v: unknown) => {
      inserts.push({ table, v });
      return {
        select: () => ({ single: async () => ({ data: { id: "p1", expires_at: "x" }, error: null }) }),
      };
    };
    return q;
  };
  return { db: { from: chain }, inserts, updates };
}

describe("proposal tools", () => {
  it("[UNIT] propose_cancel_order only inserts a pending proposal and never touches the order", async () => {
    const f = fakeDb({ id: 7, state: "acknowledged", broker_symbol: "EURUSD", account_mode: "demo_auto" });
    const r = await runProposeCancelOrder(f.db, "u", { delivery_id: 7 }, "mcp");
    expect(r.isError).toBeUndefined();
    expect(f.inserts).toHaveLength(1);
    expect((f.inserts[0] as { table: string }).table).toBe("ai_action_proposals");
    expect(f.updates).toHaveLength(0);
  });

  it("[UNIT] propose_cancel_order refuses filled or foreign orders", async () => {
    const filled = fakeDb({ id: 7, state: "filled" });
    expect((await runProposeCancelOrder(filled.db, "u", { delivery_id: 7 }, "mcp")).isError).toBe(true);
    const foreign = fakeDb(null);
    expect((await runProposeCancelOrder(foreign.db, "u", { delivery_id: 7 }, "mcp")).isError).toBe(true);
    expect(filled.inserts.length + foreign.inserts.length).toBe(0);
  });

  it("[UNIT] reduce without a risk share is refused", async () => {
    const f = fakeDb(null);
    const r = await runProposeCohortPolicy(
      f.db,
      "u",
      { instrument: "XAUUSD", direction: "short", policy: "reduce" },
      "in_app",
    );
    expect(r.isError).toBe(true);
    expect(f.inserts).toHaveLength(0);
  });
});
