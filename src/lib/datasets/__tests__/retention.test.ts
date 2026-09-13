/**
 * Retention contract: clean-up may remove a setup from the interactive feed, but
 * it must archive first and it must never delete a learning row.
 *
 * These assertions read the applied migration SQL, which is the authority on what
 * the database actually does.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { DATASETS, datasetById } from "@/lib/datasets/catalog";

const MIGRATIONS_DIR = join(process.cwd(), "drizzle", "migrations");

function migrationSql(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n");
}

describe("retention contract", () => {
  const sql = migrationSql();

  it("[INVARIANT] archives the setup, its context and its cascade-deleted children", () => {
    expect(sql).toContain("INSERT INTO public.signal_retention_archive");
    expect(sql).toContain("market_context_snapshot");
    expect(sql).toContain("'executed_trades',");
    expect(sql).toContain("'signal_user_telemetry',");
  });

  it("[INVARIANT] refuses to delete a setup that has no archive row", () => {
    expect(sql).toContain("-- Nothing is deleted unless the archive row exists.");
    expect(sql).toMatch(/DELETE FROM _purge_ids p[\s\S]*signal_retention_archive/);
  });

  it("[INVARIANT] stamps lineage onto every learning table before deletion", () => {
    for (const table of [
      "shadow_executions",
      "model_observations",
      "research_candidates",
      "sizing_divergence_log",
    ]) {
      expect(sql).toMatch(
        new RegExp(`ALTER TABLE public\\.${table}\\s+ADD COLUMN IF NOT EXISTS archived_signal_id`),
      );
      expect(sql).toMatch(
        new RegExp(`UPDATE public\\.${table}[\\s\\S]{0,120}archived_signal_id =`),
      );
    }
  });

  it("[INVARIANT] never deletes a learning row", () => {
    for (const table of ["shadow_executions", "model_observations", "research_candidates"]) {
      expect(sql).not.toMatch(new RegExp(`DELETE FROM public\\.${table}\\b`));
    }
  });

  it("[INVARIANT] keeps archived setups exportable as a training dataset", () => {
    const spec = datasetById("archived_signals");
    expect(spec?.table).toBe("signal_retention_archive");
    expect(spec?.timeColumn).toBe("detected_at");
    expect(sql).toContain("WHEN 'archived_signals' THEN");
    expect(DATASETS.map((d) => d.id)).toContain("archived_signals");
  });

  it("[INVARIANT] keeps the archive owner-gated and insert-only", () => {
    expect(sql).toContain("signal_retention_archive is insert-only");
    expect(sql).toContain('CREATE POLICY "archive_owner_read"');
    expect(sql).toContain("USING (public.is_admin())");
  });
});
