/**
 * Open/closed memory for the admin terminal panels.
 *
 * Presentation state only — nothing here touches engine behaviour. The state is
 * kept in `localStorage` so the owner's layout survives a reload, and a browser
 * event lets "expand all"/"collapse all" reach every mounted panel without a
 * shared React context threaded through every panel component.
 */
import { useCallback, useEffect, useState } from "react";

const PREFIX = "ptrades.admin.panel.";
const EVENT = "ptrades-admin-panels";

interface PanelEventDetail {
  /** `null` means "every panel". */
  key: string | null;
  open: boolean;
}

/** Stable storage key for a panel title. */
export function panelStorageKey(key: string): string {
  return `${PREFIX}${key}`;
}

/**
 * Reads the stored preference. Returns `null` when nothing is stored (or storage
 * is unavailable) so the caller can fall back to the panel's own default.
 */
export function readPanelOpen(key: string): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(panelStorageKey(key));
    if (raw === "1") return true;
    if (raw === "0") return false;
    return null;
  } catch {
    return null;
  }
}

function writePanelOpen(key: string, open: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(panelStorageKey(key), open ? "1" : "0");
  } catch {
    // A blocked storage quota must not break the terminal; the panel simply
    // forgets its state on the next load.
  }
}

function broadcast(detail: PanelEventDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<PanelEventDetail>(EVENT, { detail }));
}

/** Persists and broadcasts a single panel's state. */
export function setPanelOpen(key: string, open: boolean): void {
  writePanelOpen(key, open);
  broadcast({ key, open });
}

/**
 * Expand or collapse every panel. Individual keys are not enumerated here: each
 * mounted panel receives the broadcast and persists its own key, which keeps
 * this helper correct as panels are added or removed.
 */
export function setAllPanelsOpen(open: boolean): void {
  broadcast({ key: null, open });
}

/**
 * Panel open state.
 *
 * The stored value is read in an effect rather than in the `useState`
 * initializer: reading storage during render would differ between the server
 * pass and hydration.
 */
export function usePanelOpen(key: string, defaultOpen: boolean) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    const stored = readPanelOpen(key);
    if (stored !== null) setOpen(stored);
  }, [key]);

  useEffect(() => {
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<PanelEventDetail>).detail;
      if (!detail) return;
      if (detail.key !== null && detail.key !== key) return;
      setOpen(detail.open);
      // A bulk toggle must be remembered per panel too, otherwise the next load
      // would silently revert to the defaults.
      if (detail.key === null) writePanelOpen(key, detail.open);
    };
    window.addEventListener(EVENT, onEvent);
    return () => window.removeEventListener(EVENT, onEvent);
  }, [key]);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      writePanelOpen(key, next);
      return next;
    });
  }, [key]);

  return { open, toggle };
}
