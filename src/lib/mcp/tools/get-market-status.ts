import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";
import { formatDuration, marketStatus } from "@/lib/market-hours";

export default defineTool({
  name: "get_market_status",
  title: "Get market status",
  description:
    "Report which FX sessions are open right now (Sydney, Tokyo, London, New York), how long until each opens or closes, the weekend closure state, the scanner's current session bucket, and per-instrument broker feed health.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const now = new Date();
    const status = marketStatus(now);

    const supabase = supabaseForUser(ctx);
    const { data: health, error } = await supabase
      .from("instrument_health")
      .select("instrument, available, last_error, unavailable_until, updated_at");
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const payload = {
      as_of_utc: now.toISOString(),
      weekend_closed: status.weekendClosed,
      reopens_in: status.minutesToReopen === null ? null : formatDuration(status.minutesToReopen),
      scanner_session: status.scannerSession,
      open_session_count: status.openCount,
      sessions: status.sessions.map((s) => ({
        key: s.key,
        label: s.label,
        open: s.open,
        open_hour_utc: s.openHour,
        close_hour_utc: s.closeHour,
        [s.open ? "closes_in" : "opens_in"]: formatDuration(s.minutesToChange),
      })),
      instrument_health: health ?? [],
    };

    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
