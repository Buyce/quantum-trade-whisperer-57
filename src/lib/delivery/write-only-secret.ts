/**
 * Resolve a write-only credential without ever requiring the client to receive
 * and echo the stored value. Blank input preserves the existing secret; a
 * nonblank input is both the effective value and the only value written.
 */
export function resolveWriteOnlySecret(
  submitted: string | null | undefined,
  stored: string | null | undefined,
): { effective: string; replacement: string | null } {
  const replacement = submitted?.trim() ?? "";
  const effective = replacement || stored?.trim() || "";
  return { effective, replacement: replacement || null };
}
