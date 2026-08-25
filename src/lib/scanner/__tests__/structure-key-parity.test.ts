/**
 * Structure-identity parity gate (Phase A2A, R1-FIX).
 *
 * Duplicate detection compares a freshly built structure key against the keys
 * already stored in `scanned_signals`. If the renderer changes, stored keys stop
 * matching and a lingering structure can be republished every cycle. This gate
 * replays every DISTINCT live key through the current identity function and
 * demands byte equality.
 */
import { describe, expect, it } from "vitest";
import { structureKeyOf } from "../profile";
import {
  STRUCTURE_KEY_STOP_DECIMALS,
  STRUCTURE_KEY_VERSION,
  buildStructureKey,
  parseStructureKey,
} from "../structure-key";
import { LIVE_STRUCTURE_KEYS } from "@/test/fixtures/live-structure-keys";
import { priceDecimals } from "@/lib/instruments/precision";

describe("structure identity", () => {
  it("[INVARIANT] the live-key fixture is populated, so this gate cannot pass vacuously", () => {
    expect(LIVE_STRUCTURE_KEYS.length).toBeGreaterThan(100);
    expect(new Set(LIVE_STRUCTURE_KEYS.map((k) => k.split("|")[0]))).toEqual(
      new Set(["XAUUSD", "GBPAUD", "EURUSD"]),
    );
  });

  it("[INVARIANT] every live structure key is reproduced byte-for-byte from its own parts", () => {
    for (const key of LIVE_STRUCTURE_KEYS) {
      const parts = parseStructureKey(key);
      expect({ key, parsed: parts !== null }).toEqual({ key, parsed: true });
      expect(buildStructureKey(parts!)).toBe(key);
      expect(structureKeyOf(parts!)).toBe(key);
    }
  });

  it("[INVARIANT] identity does not depend on the instrument's display precision", () => {
    // XAUUSD displays at 2 decimals; its identity must still render 5.
    expect(priceDecimals("XAUUSD")).toBe(2);
    expect(
      structureKeyOf({
        instrument: "XAUUSD",
        direction: "long",
        aTime: "2026-08-24T22:00:00.000Z",
        bTime: "2026-08-25T00:30:00.000Z",
        stopLoss: 4649.93597,
      }),
    ).toBe("XAUUSD|long|2026-08-24T22:00:00.000Z|2026-08-25T00:30:00.000Z|4649.93597");
  });

  it("[UNIT] the identity version and stop rendering are pinned", () => {
    expect(STRUCTURE_KEY_VERSION).toBe(1);
    expect(STRUCTURE_KEY_STOP_DECIMALS).toBe(5);
  });

  it("[UNIT] a malformed key is refused rather than half-parsed", () => {
    expect(parseStructureKey("EURUSD|long|a|b")).toBeNull();
    expect(parseStructureKey("EURUSD|sideways|a|b|1.10000")).toBeNull();
    expect(parseStructureKey("EURUSD|long|a|b|not-a-price")).toBeNull();
  });
});
