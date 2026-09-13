/**
 * Owner-only dataset export.
 *
 * Row counts and rows come from the owner-gated SQL reads, so what downloads is
 * exactly what is recorded: no smoothing, no placeholder rows, and an empty
 * window downloads an empty file with a row count of zero. Account-identifying
 * columns are withheld in the database, not in this component.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { PanelShell } from "@/components/admin/AdminPanels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { downloadCsv, downloadJson, toCsv } from "@/lib/export";
import { MAX_DATASET_PAGE, datasetById } from "@/lib/datasets/catalog";
import { getDatasetInventory, readDataset } from "@/lib/datasets/datasets.functions";

function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

export function DatasetExportPanel() {
  const inventoryFn = useServerFn(getDatasetInventory);
  const readFn = useServerFn(readDataset);
  const [since, setSince] = useState(isoDay(-90));
  const [until, setUntil] = useState(isoDay(1));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const windowArgs = {
    since: new Date(`${since}T00:00:00Z`).toISOString(),
    until: new Date(`${until}T00:00:00Z`).toISOString(),
  };

  const inventory = useQuery({
    queryKey: ["dataset-inventory", windowArgs.since, windowArgs.until],
    queryFn: () => inventoryFn({ data: windowArgs }),
    staleTime: 60_000,
  });

  async function fetchAll(dataset: string) {
    const rows: Array<Record<string, unknown>> = [];
    let offset = 0;
    for (;;) {
      const page = await readFn({
        data: { dataset, ...windowArgs, limit: MAX_DATASET_PAGE, offset },
      });
      rows.push(...page.rows);
      if (page.rowCount < MAX_DATASET_PAGE) return { rows, page };
      offset += page.rowCount;
      // Guard against an unbounded loop on a very large window.
      if (rows.length >= 200_000) return { rows, page };
    }
  }

  async function download(dataset: string, format: "csv" | "jsonl") {
    setBusy(`${dataset}:${format}`);
    setError(null);
    try {
      const { rows, page } = await fetchAll(dataset);
      const stamp = `${since}_${until}`;
      if (format === "csv") {
        const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
        const csv = toCsv(
          headers,
          rows.map((r) =>
            headers.map((h) => {
              const v = r[h];
              return v !== null && typeof v === "object" ? JSON.stringify(v) : (v ?? "");
            }),
          ),
        );
        downloadCsv(`ptrades_${dataset}_${stamp}.csv`, csv);
      } else {
        downloadJson(`ptrades_${dataset}_${stamp}.meta.json`, {
          dataset,
          table: page.table,
          time_column: page.timeColumn,
          since: page.since,
          until: page.until,
          rows_exported: rows.length,
          rows_in_window: page.totalInWindow,
          provenance: page.provenance,
          withheld_columns: page.withheldColumns,
          not_to_be_read_as: page.nonGuarantee,
          note: "Real recorded rows only. An empty file means nothing was recorded in this window.",
        });
        downloadCsv(
          `ptrades_${dataset}_${stamp}.jsonl`,
          rows.map((r) => JSON.stringify(r)).join("\n"),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <PanelShell title="Training data export — owner only">
      <p className="text-xs text-muted-foreground">
        Downloads real recorded rows over the window below. Account identifiers are withheld in the
        database. CSV is for spreadsheets; JSONL ships with a companion metadata file stating row
        counts, window and provenance.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="block text-muted-foreground">From (UTC)</span>
          <Input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
        </label>
        <label className="text-xs">
          <span className="block text-muted-foreground">To (UTC, exclusive)</span>
          <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {inventory.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : inventory.isError ? (
        <p className="text-xs text-destructive">Could not read the dataset inventory.</p>
      ) : (
        <div className="-mx-2 overflow-x-auto px-2">
          <table className="w-full min-w-[560px] text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-2">Dataset</th>
                <th className="py-1 pr-2">Provenance</th>
                <th className="py-1 pr-2 text-right">Rows</th>
                <th className="py-1 pr-2">Download</th>
              </tr>
            </thead>
            <tbody>
              {(inventory.data?.datasets ?? []).map((d) => (
                <tr key={d.id} className="border-t border-border align-middle">
                  <td className="py-1 pr-2">
                    <span className="font-medium">{d.label}</span>
                    <span className="block text-[10px] text-muted-foreground">
                      {datasetById(d.id)?.rowMeaning}
                    </span>
                  </td>
                  <td className="py-1 pr-2 text-muted-foreground">{d.provenance}</td>
                  <td className="py-1 pr-2 text-right font-mono">{d.rowsInWindow}</td>
                  <td className="py-1 pr-2">
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => download(d.id, "csv")}
                      >
                        {busy === `${d.id}:csv` ? "…" : "CSV"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => download(d.id, "jsonl")}
                      >
                        {busy === `${d.id}:jsonl` ? "…" : "JSONL"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[10px] text-muted-foreground">
        Zero rows means nothing was recorded in this window. Replay figures are in-sample
        measurements; demo broker evidence is not a live-money track record.
      </p>
    </PanelShell>
  );
}
