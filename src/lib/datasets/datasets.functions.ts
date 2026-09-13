/**
 * Owner-gated, read-only training-dataset reads.
 *
 * Both functions call the SECURITY DEFINER SQL functions, which apply the same
 * owner gate again in the database and withhold account-identifying columns.
 * Nothing here writes, and nothing here invents a row: an empty window returns
 * zero rows and a row count of zero.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  DATASETS,
  DEFAULT_DATASET_PAGE,
  MAX_DATASET_PAGE,
  datasetById,
} from "@/lib/datasets/catalog";

const OWNER_EMAIL = "boatengampomah@gmail.com";

export interface DatasetPage {
  dataset: string;
  table: string;
  timeColumn: string;
  since: string;
  until: string;
  limit: number;
  offset: number;
  withheldColumns: string[];
  rowCount: number;
  totalInWindow: number;
  provenance: string;
  nonGuarantee: string;
  rows: Array<Record<string, unknown>>;
}

export interface DatasetInventoryEntry {
  id: string;
  label: string;
  table: string;
  provenance: string;
  rowsInWindow: number;
}

function ownerOnly(claims: Record<string, unknown>) {
  const email = String(claims["email"] ?? "").toLowerCase();
  if (email !== OWNER_EMAIL) throw new Error("Forbidden");
}

function window(input: { since?: string; until?: string }) {
  const until = input.until ? new Date(input.until) : new Date();
  const since = input.since
    ? new Date(input.since)
    : new Date(until.getTime() - 90 * 24 * 3_600_000);
  if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) {
    throw new Error("Invalid time window");
  }
  return { since: since.toISOString(), until: until.toISOString() };
}

/** Row counts per dataset for the requested window — real counts, computed in SQL. */
export const getDatasetInventory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { since?: string; until?: string } | undefined) => data ?? {})
  .handler(
    async ({
      context,
      data,
    }): Promise<{ since: string; until: string; datasets: DatasetInventoryEntry[] }> => {
      ownerOnly(context.claims);
      const { since, until } = window(data);
      const { adminClient } = await import("@/lib/scanner/pipeline.server");
      const admin = adminClient();

      const datasets: DatasetInventoryEntry[] = [];
      for (const spec of DATASETS) {
        const { data: count, error } = await admin.rpc("count_training_dataset", {
          _dataset: spec.id,
          _since: since,
          _until: until,
        });
        if (error) throw new Error(`${spec.id}: ${error.message}`);
        datasets.push({
          id: spec.id,
          label: spec.label,
          table: spec.table,
          provenance: spec.provenance,
          rowsInWindow: Number(count ?? 0),
        });
      }
      return { since, until, datasets };
    },
  );

/** One page of real recorded rows from a whitelisted dataset. */
export const readDataset = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { dataset: string; since?: string; until?: string; limit?: number; offset?: number }) =>
      data,
  )
  .handler(async ({ context, data }): Promise<DatasetPage> => {
    ownerOnly(context.claims);
    const spec = datasetById(data.dataset);
    if (!spec) throw new Error(`Unknown dataset: ${data.dataset}`);
    const { since, until } = window(data);
    const limit = Math.min(Math.max(data.limit ?? DEFAULT_DATASET_PAGE, 1), MAX_DATASET_PAGE);
    const offset = Math.max(data.offset ?? 0, 0);

    const { adminClient } = await import("@/lib/scanner/pipeline.server");
    const admin = adminClient();

    const [page, total] = await Promise.all([
      admin.rpc("read_training_dataset", {
        _dataset: spec.id,
        _since: since,
        _until: until,
        _limit: limit,
        _offset: offset,
      }),
      admin.rpc("count_training_dataset", { _dataset: spec.id, _since: since, _until: until }),
    ]);
    if (page.error) throw new Error(page.error.message);
    if (total.error) throw new Error(total.error.message);

    const payload = (page.data ?? {}) as {
      rows?: Array<Record<string, unknown>>;
      withheld_columns?: string[];
      row_count?: number;
    };

    return {
      dataset: spec.id,
      table: spec.table,
      timeColumn: spec.timeColumn,
      since,
      until,
      limit,
      offset,
      withheldColumns: payload.withheld_columns ?? spec.withheldColumns,
      rowCount: Number(payload.row_count ?? 0),
      totalInWindow: Number(total.data ?? 0),
      provenance: spec.provenance,
      nonGuarantee: spec.nonGuarantee,
      rows: payload.rows ?? [],
    };
  });
