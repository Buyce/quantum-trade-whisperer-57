import { describe, expect, it, vi } from "vitest";
import { isChunkLoadError, recoverFromChunkError } from "@/lib/chunk-reload";

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe("[UNIT] chunk reload recovery", () => {
  it("[UNIT] recognises stale-chunk failures", () => {
    expect(
      isChunkLoadError(new Error("Failed to fetch dynamically imported module: /assets/x.js")),
    ).toBe(true);
    expect(isChunkLoadError(new Error("Loading chunk 42 failed"))).toBe(true);
  });

  it("[UNIT] ignores ordinary application errors", () => {
    expect(isChunkLoadError(new RangeError("Invalid time value"))).toBe(false);
    expect(isChunkLoadError(new Error("column x.reason does not exist"))).toBe(false);
  });

  it("[UNIT] reloads once and never loops", () => {
    const storage = fakeStorage();
    const reload = vi.fn();
    const err = new Error("Failed to fetch dynamically imported module");
    expect(recoverFromChunkError(err, storage, reload)).toBe(true);
    expect(recoverFromChunkError(err, storage, reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("[UNIT] does nothing without storage or for other errors", () => {
    const reload = vi.fn();
    expect(recoverFromChunkError(new Error("boom"), fakeStorage(), reload)).toBe(false);
    expect(recoverFromChunkError(new Error("Loading chunk 1 failed"), undefined, reload)).toBe(
      false,
    );
    expect(reload).not.toHaveBeenCalled();
  });
});
