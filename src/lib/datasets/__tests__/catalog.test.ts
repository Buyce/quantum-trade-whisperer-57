/**
 * [INVARIANT] The exportable-dataset catalogue must match the SQL that reads it,
 * must withhold account identifiers, and must stay read-only.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DATASETS, DATASET_IDS, datasetById } from "@/lib/datasets/catalog";

const ROOT = process.cwd();

function migrationSql(): string {
  const dirs = ["supabase/migrations", "drizzle/migrations"];
  let text = "";
  for (const dir of dirs) {
    let entries: string[] = [];
    try {
      entries = readdirSync(join(ROOT, dir));
    } catch {
      continue;
    }
    for (const f of entries.filter((f) => f.endsWith(".sql"))) {
      text += readFileSync(join(ROOT, dir, f), "utf8");
    }
  }
  return text;
}

const SQL = migrationSql();

describe("[UNIT] dataset catalogue", () => {
  it("[UNIT] declares every dataset with a table, window column and provenance", () => {
    expect(DATASETS.length).toBeGreaterThan(0);
    for (const d of DATASETS) {
      expect(d.table).toMatch(/^[a-z_]+$/);
      expect(d.timeColumn).toMatch(/^[a-z_]+$/);
      expect(d.rowMeaning.length).toBeGreaterThan(10);
      expect(d.nonGuarantee.length).toBeGreaterThan(10);
    }
    expect(new Set(DATASET_IDS).size).toBe(DATASET_IDS.length);
  });

  it("[UNIT] every dataset is whitelisted in the SQL read with the same table and window column", () => {
    for (const d of DATASETS) {
      const clause = new RegExp(
        `WHEN '${d.id}' THEN[\\s\\S]{0,200}?'${d.table}'[\\s\\S]{0,200}?'${d.timeColumn}'`,
      );
      expect(clause.test(SQL), `SQL must whitelist ${d.id} -> ${d.table}.${d.timeColumn}`).toBe(
        true,
      );
    }
  });

  it("[UNIT] the SQL reads are owner-gated and never write", () => {
    const fn = SQL.slice(SQL.indexOf("read_training_dataset"));
    expect(fn).toContain("public.is_admin()");
    expect(fn).toMatch(/RAISE EXCEPTION 'forbidden'/);
    expect(SQL).not.toMatch(
      /read_training_dataset[\s\S]{0,3000}?(INSERT INTO|UPDATE public\.|DELETE FROM)/,
    );
  });

  it("[UNIT] broker evidence withholds account-identifying columns", () => {
    const broker = datasetById("broker_trades");
    expect(broker).toBeDefined();
    for (const col of ["user_id", "account_id", "metaapi_account_id", "client_id", "deals"]) {
      expect(broker!.withheldColumns).toContain(col);
      expect(SQL).toContain(`'${col}'`);
    }
  });
});

describe("[UNIT] read-only assistant surface", () => {
  const index = readFileSync(join(ROOT, "src/lib/mcp/index.ts"), "utf8");
  const describeTool = readFileSync(join(ROOT, "src/lib/mcp/tools/describe_datasets.ts"), "utf8");
  const readTool = readFileSync(join(ROOT, "src/lib/mcp/tools/read_dataset.ts"), "utf8");

  it("[UNIT] both dataset tools are registered", () => {
    expect(index).toContain("describeDatasets");
    expect(index).toContain("readDataset");
  });

  it("[UNIT] both dataset tools are annotated read-only and perform no writes", () => {
    for (const [name, src] of [
      ["describe_datasets", describeTool],
      ["read_dataset", readTool],
    ] as const) {
      expect(src, `${name} must be read-only`).toContain("readOnlyHint: true");
      expect(src, `${name} must not write`).not.toMatch(/\.(insert|update|upsert|delete)\s*\(/);
    }
  });

  it("[UNIT] read_dataset never claims an empty page proves a market or scanner state", () => {
    expect(readTool).toMatch(/never infer a scanner state from it/i);
  });
});
