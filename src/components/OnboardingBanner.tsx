import { useEffect, useState } from "react";
import { GraduationCap, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const KEY = "ptrades.onboarding.dismissed";

const STEPS = [
  "The scanner reviews XAUUSD, GBPAUD and EURUSD every 15 minutes and only publishes setups that pass its rules — so an empty feed is normal.",
  "Each card is a plan, not an instruction: it shows the order type, entry, stop-loss and three take-profit levels, plus how confident the model is.",
  "Use Copy order details to paste the levels into your broker, then log the setup as Taken or Skipped so the Performance page can measure your edge.",
];

export function OnboardingBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      setShow(localStorage.getItem(KEY) !== "1");
    } catch {
      setShow(false);
    }
  }, []);

  if (!show) return null;

  function dismiss() {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    setShow(false);
  }

  return (
    <aside className="relative rounded-md border border-primary/40 bg-primary/5 px-4 py-4">
      <Button
        variant="ghost"
        size="sm"
        onClick={dismiss}
        aria-label="Dismiss getting started"
        className="absolute right-2 top-2 size-7 p-0"
      >
        <X className="size-4" />
      </Button>
      <p className="label-xs flex items-center gap-1.5">
        <GraduationCap className="size-3.5" /> Getting started
      </p>
      <ol className="mt-3 space-y-2 pr-8">
        {STEPS.map((s, i) => (
          <li key={i} className="flex gap-2 text-sm leading-relaxed text-foreground/90">
            <span className="num text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      <div className="mt-3">
        <Button size="sm" variant="outline" onClick={dismiss}>
          Got it
        </Button>
      </div>
    </aside>
  );
}
