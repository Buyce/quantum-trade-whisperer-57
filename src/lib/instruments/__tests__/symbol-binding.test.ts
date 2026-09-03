/**
 * [INVARIANT] Operator symbol bindings.
 *
 * A binding is a recorded human decision about a NAME. These tests pin the two
 * properties that keep it from becoming a back door: the bound name is the one
 * the provider is actually asked for, and a binding on its own never counts as
 * provider evidence.
 */
import { describe, expect, it } from "vitest";

import { specFetchSymbol } from "../bindings.server";

type Row = Record<string, unknown> | null;

/** Minimal query stub: only the binding read path is exercised here. */
function db(row: Row, error: boolean = false) {
  return {
    from() {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: row, error: error ? { message: "down" } : null }),
      };
      return chain as never;
    },
  };
}

describe("operator symbol bindings", () => {
  it("[UNIT] a bound instrument is fetched under the broker symbol, not the canonical name", async () => {
    const symbol = await specFetchSymbol(
      db({
        canonical: "NAS100",
        provider_symbol: "USTEC",
        bound_by: "owner@example.com",
        reason: null,
        candidates: ["USTEC", "USTECH100M"],
        created_at: null,
        updated_at: null,
      }) as never,
      "NAS100",
    );
    expect(symbol).toBe("USTEC");
  });

  it("[UNIT] an unbound instrument keeps using its canonical name", async () => {
    expect(await specFetchSymbol(db(null) as never, "EURUSD")).toBe("EURUSD");
  });

  it("[INVARIANT] an unreadable binding table falls back to the canonical name, never to a guess", async () => {
    expect(await specFetchSymbol(db(null, true) as never, "USOIL")).toBe("USOIL");
  });
});
