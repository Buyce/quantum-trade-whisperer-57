/**
 * The scanner's starvation watch must be able to run from the pg_cron scan
 * cycle. That cycle calls it with the server-only service-role client, which
 * carries no user email, so the admin-gated `get_admin_engine_status` refuses it
 * with 'forbidden' — the watch then reported `checked: false` on every cycle and
 * could never open or clear an incident. These tests pin the read to the
 * service-role-only aggregate and pin the measured numbers it acts on.
 */
import { describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "@/test/fakes/supabase";

import { runStarvationWatch } from "../starvation-watch.server";

const run = (fake: ReturnType<typeof createFakeSupabase>) =>
  runStarvationWatch(fake.client as Parameters<typeof runStarvationWatch>[0]);

describe("scanner starvation watch", () => {
  it("[INVARIANT] reads engine numbers through the function the scheduled job can call", async () => {
    const fake = createFakeSupabase(
      () => ({ data: [], error: null }),
      (fn) => {
        if (fn === "build_engine_status") {
          return {
            data: {
              scan: {
                window_minutes: 60,
                total: 12,
                stale: 0,
                analysed: 12,
                last_analysed_at: "2026-11-12T10:00:00Z",
                last_candle_fetch_at: "2026-11-12T10:00:00Z",
              },
              link: { ok: 8, failed: 0 },
            },
            error: null,
          };
        }
        return { data: true, error: null };
      },
    );

    const outcome = await run(fake);

    expect(fake.rpcCalls[0]?.fn).toBe("build_engine_status");
    expect(fake.rpcCalls.map((c) => c.fn)).not.toContain("get_admin_engine_status");
    expect(outcome.checked).toBe(true);
    expect(outcome.starved).toBe(false);
  });

  it("[INVARIANT] reports a refused read instead of pretending the queue is healthy", async () => {
    const fake = createFakeSupabase(
      () => ({ data: [], error: null }),
      () => ({ data: null, error: { message: "forbidden" } }),
    );

    const outcome = await run(fake);

    expect(outcome.checked).toBe(false);
    expect(outcome.reason).toBe("forbidden");
  });

  it("[INVARIANT] opens an incident from the measured stale and analysed counts", async () => {
    const fake = createFakeSupabase(
      () => ({ data: [], error: null }),
      (fn) => {
        if (fn === "build_engine_status") {
          return {
            data: {
              scan: {
                window_minutes: 60,
                total: 30,
                stale: 30,
                analysed: 0,
                last_analysed_at: null,
                last_candle_fetch_at: null,
              },
              link: { ok: 0, failed: 4 },
            },
            error: null,
          };
        }
        // null id = an incident is already open, so no notification is sent.
        return { data: null, error: null };
      },
    );

    const outcome = await run(fake);

    const claim = fake.rpcCalls.find((c) => c.fn === "claim_starvation_incident");
    expect(claim?.args).toMatchObject({ _stale: 30, _analysed: 0 });
    expect(outcome.checked).toBe(true);
    expect(outcome.starved).toBe(true);
  });

  it("[INVARIANT] an empty window on an open market never clears an open incident", async () => {
    const fake = createFakeSupabase(
      () => ({ data: [], error: null }),
      (fn) => {
        if (fn === "build_engine_status")
          return { data: { scan: { window_minutes: 60, total: 0, stale: 0, analysed: 0 } }, error: null };
        if (fn === "claim_starvation_incident") return { data: null, error: null };
        return { data: true, error: null };
      },
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T13:00:00Z"));
    try {
      const outcome = await run(fake);
      expect(outcome.cleared).toBe(false);
      expect(fake.rpcCalls.map((c: { fn: string }) => c.fn)).not.toContain("clear_starvation_incident");
    } finally {
      vi.useRealTimers();
    }
  });

  const emptyWindow = () =>
    createFakeSupabase(
      () => ({ data: [], error: null }),
      (fn) => {
        if (fn === "build_engine_status")
          return { data: { scan: { window_minutes: 60, total: 0, stale: 0, analysed: 0 } }, error: null };
        if (fn === "claim_starvation_incident") return { data: 7, error: null };
        return { data: true, error: null };
      },
    );

  for (const at of ["2026-11-15T21:00:00Z", "2026-11-15T21:59:00Z"]) {
    it(`[INVARIANT] no incident opens in the reopen grace hour (${at})`, async () => {
      const fake = emptyWindow();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(at));
      try {
        const outcome = await run(fake);
        expect(outcome.incidentOpened).toBe(false);
        expect(outcome.reason).toBe("reopen grace");
        const fns = fake.rpcCalls.map((c: { fn: string }) => c.fn);
        expect(fns).not.toContain("claim_starvation_incident");
        expect(fns).not.toContain("clear_starvation_incident");
      } finally {
        vi.useRealTimers();
      }
    });
  }

  it("[INVARIANT] an empty window after the grace hour still opens an incident", async () => {
    const fake = emptyWindow();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T22:01:00Z"));
    try {
      await run(fake);
      expect(fake.rpcCalls.map((c: { fn: string }) => c.fn)).toContain("claim_starvation_incident");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("scanner starvation email", () => {
  it("[INVARIANT] omits the freshness-limit claim when nothing was discarded", async () => {
    const { render } = await import("@react-email/components");
    const { template } = await import("@/lib/email-templates/scanner-starved");
    const React = await import("react");
    const html0 = await render(React.createElement(template.component, { stale: 0, analysed: 0, windowMinutes: 60 }));
    expect(html0).not.toContain("freshness limit");
    expect(html0).toContain("No scan jobs finished");
    const html5 = await render(React.createElement(template.component, { stale: 5, analysed: 0, windowMinutes: 60 }));
    expect(html5).toContain("freshness limit");
  });
});
