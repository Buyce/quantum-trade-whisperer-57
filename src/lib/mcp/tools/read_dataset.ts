import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import {
  DATASET_IDS,
  DEFAULT_DATASET_PAGE,
  MAX_DATASET_PAGE,
  datasetById,
} from "@/lib/datasets/catalog";

/**
 * Read-only paged read of one training dataset. The SQL function re-applies the
 * owner gate in the database and withholds account-identifying columns, so a
 * non-owner token returns an authorisation error rather than rows.
 */
export default defineTool({
  name: "read_dataset",
  title: "Read a training dataset",
  description:
    "Read one page of real recorded rows from a named dataset over an explicit UTC time window, ordered oldest first. Call `describe_datasets` first for the ids and what each row means. Read-only: this tool cannot write, change or delete anything. Account-identifying columns are always withheld. An empty page means nothing was recorded in that window — never infer a scanner state from it, and never fabricate rows to fill a gap.",
  inputSchema: {
    dataset: z
      .enum(DATASET_IDS as [string, ...string[]])
      .describe("Dataset id from describe_datasets."),
    since: z.string().describe("Window start, ISO-8601 UTC, inclusive."),
    until: z.string().describe("Window end, ISO-8601 UTC, exclusive."),
    limit: z.number().optional().describe(`Rows per page, up to ${MAX_DATASET_PAGE}.`),
    offset: z.number().optional().describe("Rows to skip, for paging through the window."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const spec = datasetById(input.dataset);
    if (!spec) {
      return {
        content: [{ type: "text", text: `Unknown dataset ${input.dataset}` }],
        isError: true,
      };
    }
    const since = new Date(input.since);
    const until = new Date(input.until);
    if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime()) || since >= until) {
      return {
        content: [
          { type: "text", text: "since and until must be ISO-8601 UTC with since < until" },
        ],
        isError: true,
      };
    }

    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase.rpc("read_training_dataset", {
      _dataset: spec.id,
      _since: since.toISOString(),
      _until: until.toISOString(),
      _limit: Math.min(Math.max(input.limit ?? DEFAULT_DATASET_PAGE, 1), MAX_DATASET_PAGE),
      _offset: Math.max(input.offset ?? 0, 0),
    });
    if (error) {
      const forbidden = /forbidden|permission/i.test(error.message);
      return {
        content: [
          {
            type: "text",
            text: forbidden
              ? "This dataset is owner-gated: the signed-in account is not authorised to read it."
              : error.message,
          },
        ],
        isError: true,
      };
    }

    const page = (data ?? {}) as Record<string, unknown>;
    const payload = {
      ...page,
      provenance: spec.provenance,
      row_meaning: spec.rowMeaning,
      not_to_be_read_as: spec.nonGuarantee,
      note: "Real recorded rows only. Page through with offset until row_count is 0.",
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
