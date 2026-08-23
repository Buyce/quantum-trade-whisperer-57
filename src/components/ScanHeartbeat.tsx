import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

function formatTime(date: Date) {
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/**
 * "Last scanned" heartbeat. Reads the timestamp the scanner already writes to
 * instrument_health — no scanner logic is involved or modified.
 */
export function ScanHeartbeat({ lastScanAt }: { lastScanAt: string | null | undefined }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const last = lastScanAt ? new Date(lastScanAt) : null;
  const valid = last && !Number.isNaN(last.getTime());
  const ageMin = valid ? (now - last.getTime()) / 60_000 : Infinity;
  const stale = ageMin > 45;

  const nextInMin = valid && !stale ? Math.max(1, Math.ceil(15 - (ageMin % 15))) : null;

  return (
    <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
      <span className="relative flex size-2">
        <span
          className={cn(
            "absolute inline-flex size-full animate-ping rounded-full opacity-75",
            stale ? "bg-warning" : "bg-success",
          )}
        />
        <span
          className={cn(
            "relative inline-flex size-2 rounded-full",
            stale ? "bg-warning" : "bg-success",
          )}
        />
      </span>
      {valid && !stale ? (
        <span className="num">
          Last background scan completed at: {formatTime(last!)} — Next scan in ~{nextInMin} mins.
        </span>
      ) : valid ? (
        <span className="num">
          Last background scan completed at: {formatTime(last!)} — scan cycle appears delayed.
        </span>
      ) : (
        <span>Waiting for the first background scan of this session.</span>
      )}
    </div>
  );
}
