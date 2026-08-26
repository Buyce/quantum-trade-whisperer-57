/**
 * Admin panel open/closed memory.
 *
 * Presentation state only. The point of these tests is that the terminal never
 * *guesses*: an unset panel reports "no preference" so the caller can apply its
 * own default, and a bulk toggle reaches every listener.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  panelStorageKey,
  readPanelOpen,
  setAllPanelsOpen,
  setPanelOpen,
} from "@/components/admin/panel-state";

function fakeWindow() {
  const store = new Map<string, string>();
  const target = new EventTarget();
  return {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    __store: store,
  };
}

let win: ReturnType<typeof fakeWindow>;

beforeEach(() => {
  win = fakeWindow();
  (globalThis as { window?: unknown }).window = win;
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("admin panel state", () => {
  it("[INVARIANT] namespaces storage keys", () => {
    expect(panelStorageKey("Engine status")).toBe("ptrades.admin.panel.Engine status");
  });

  it("[INVARIANT] reports no preference until one is stored", () => {
    expect(readPanelOpen("Payoff")).toBeNull();
  });

  it("[INVARIANT] round-trips an explicit preference", () => {
    setPanelOpen("Payoff", true);
    expect(readPanelOpen("Payoff")).toBe(true);
    setPanelOpen("Payoff", false);
    expect(readPanelOpen("Payoff")).toBe(false);
  });

  it("[INVARIANT] broadcasts a single panel change only for that key", () => {
    const seen: Array<{ key: string | null; open: boolean }> = [];
    win.addEventListener("ptrades-admin-panels", (e) => {
      seen.push((e as CustomEvent<{ key: string | null; open: boolean }>).detail);
    });
    setPanelOpen("News", true);
    expect(seen).toEqual([{ key: "News", open: true }]);
  });

  it("[INVARIANT] broadcasts a bulk toggle with no key so every panel reacts", () => {
    const seen: Array<{ key: string | null; open: boolean }> = [];
    win.addEventListener("ptrades-admin-panels", (e) => {
      seen.push((e as CustomEvent<{ key: string | null; open: boolean }>).detail);
    });
    setAllPanelsOpen(false);
    expect(seen).toEqual([{ key: null, open: false }]);
  });

  it("[INVARIANT] survives unavailable storage without throwing", () => {
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
      dispatchEvent: () => true,
    };
    expect(readPanelOpen("Payoff")).toBeNull();
    expect(() => setPanelOpen("Payoff", true)).not.toThrow();
  });
});
