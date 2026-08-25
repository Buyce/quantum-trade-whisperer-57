import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_scanner_status",
  title: "Get scanner status",
  description:
    "Report live scanner health per instrument (availability, last error, last scan timestamp) plus the signed-in user's feed and alert filter settings.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);

    const [health, settings] = await Promise.all([
      supabase
        .from("instrument_health")
        .select("instrument, available, last_error, unavailable_until, updated_at"),
      supabase
        .from("scanner_settings")
        .select(
          "instruments, sessions, min_grade, alert_min_grade, daily_setup_cap, notify_push, notify_email",
        )
        .maybeSingle(),
    ]);

    if (health.error)
      return { content: [{ type: "text", text: health.error.message }], isError: true };
    if (settings.error)
      return { content: [{ type: "text", text: settings.error.message }], isError: true };

    const payload = {
      instrument_health: health.data ?? [],
      scanner_settings: settings.data ?? null,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
