/**
 * What the scanner actually published in the current UTC day, before any of the
 * viewer's filters.
 *
 * Every count is a tally of real rows in the day frame. Nothing is inferred: a
 * tier with no rows is shown as 0, which means "no published row of that tier in
 * this UTC day", and never as a claim about the current scan cycle. The scanner
 * heartbeat remains the only authority on whether the engine is cycling.
 */
import type { EligibilitySignal } from "@/lib/delivery/eligibility";
import type { Grade } from "@/lib/db-types";

const GRADES = ["A+", "A", "B", "C"] as const satisfies readonly Grade[];

export function gradeMix(frame: EligibilitySignal[]): Record<Grade, number> {
  const mix = { "A+": 0, A: 0, B: 0, C: 0 } as Record<Grade, number>;
  for (const row of frame) if (row.grade in mix) mix[row.grade] += 1;
  return mix;
}

export function DayGradeMix({
  frame,
  isLoading,
  isError,
}: {
  frame: EligibilitySignal[] | undefined;
  isLoading?: boolean;
  isError?: boolean;
}) {
  if (isLoading)
    return <p className="text-xs text-muted-foreground">Reading today's published grade mix…</p>;
  if (isError || !frame)
    return (
      <p className="text-xs text-muted-foreground">
        Today's grade mix could not be read, so no count is shown here.
      </p>
    );

  const mix = gradeMix(frame);
  const total = frame.length;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-card px-3 py-2 text-xs">
      <span className="text-muted-foreground">Published this UTC day, before your filters:</span>
      {GRADES.map((g) => (
        <span key={g} className="num text-foreground">
          {g} <span className={mix[g] === 0 ? "text-muted-foreground" : ""}>{mix[g]}</span>
        </span>
      ))}
      <span className="text-muted-foreground">
        {total === 0
          ? "— nothing has been published yet today; the heartbeat below is the scanner-health authority"
          : `· ${total} total`}
      </span>
    </div>
  );
}
