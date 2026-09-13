import { defineTool } from "@lovable.dev/mcp-js";
import { DATASETS, MAX_DATASET_PAGE } from "@/lib/datasets/catalog";

/**
 * The catalogue an assistant needs before it can read anything: dataset ids,
 * what one row means, provenance and what the numbers must not be read as.
 * Static description of the schema — no rows, no database access.
 */
export default defineTool({
  name: "describe_datasets",
  title: "Describe training datasets",
  description:
    "List the read-only datasets available for analysis and model training: id, what one row means, which table it comes from, the provenance class of its numbers, the account-identifying columns that are always withheld, and what the dataset must not be read as. Read this before calling `read_dataset`. No rows are returned.",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: () => {
    const payload = {
      datasets: DATASETS.map((d) => ({
        id: d.id,
        label: d.label,
        table: d.table,
        time_column: d.timeColumn,
        provenance: d.provenance,
        row_meaning: d.rowMeaning,
        withheld_columns: d.withheldColumns,
        not_to_be_read_as: d.nonGuarantee,
      })),
      max_page_size: MAX_DATASET_PAGE,
      access: "Owner-gated and strictly read-only. There is no write path through these tools.",
      note: "Every row is a real recorded row. An empty page only means nothing was recorded in that window under that dataset — it is never evidence about the scanner's current cycle.",
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
