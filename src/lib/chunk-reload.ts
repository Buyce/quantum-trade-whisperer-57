/**
 * Stale-chunk recovery.
 *
 * Routes are lazily code-split. After a new deploy, an open tab (or a cached
 * HTML document) can ask for a chunk filename that no longer exists; the
 * dynamic import rejects and the root error boundary shows a dead-end error
 * page even though the app itself is healthy. Detect that specific failure and
 * reload once — guarded by a session flag so a genuine bug never loops.
 */

const RELOAD_FLAG = "ptrades:chunk-reload";

const CHUNK_ERROR_PATTERNS = [
  "failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "importing a module script failed",
  "loading chunk",
  "loading css chunk",
  "unable to preload css",
];

/** True when the error looks like a missing/stale build chunk, not app logic. */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();
  return CHUNK_ERROR_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Reload once for a stale-chunk error. Returns true when a reload was issued.
 * Never reloads twice in the same browser session.
 */
export function recoverFromChunkError(
  error: unknown,
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  reload: () => void,
): boolean {
  if (!isChunkLoadError(error) || !storage) return false;
  if (storage.getItem(RELOAD_FLAG)) return false;
  storage.setItem(RELOAD_FLAG, String(Date.now()));
  reload();
  return true;
}
