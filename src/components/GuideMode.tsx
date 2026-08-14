import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "ptrades.guide-mode";

type GuideModeCtx = { guide: boolean; toggle: () => void };

const Ctx = createContext<GuideModeCtx>({ guide: false, toggle: () => {} });

export function GuideModeProvider({ children }: { children: ReactNode }) {
  // Default ON for newcomers; read after mount so SSR markup stays stable.
  const [guide, setGuide] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      setGuide(raw === null ? true : raw === "on");
    } catch {
      setGuide(true);
    }
  }, []);

  const toggle = useCallback(() => {
    setGuide((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
      } catch {
        /* storage unavailable — session-only toggle */
      }
      return next;
    });
  }, []);

  const value = useMemo(() => ({ guide, toggle }), [guide, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGuideMode() {
  return useContext(Ctx);
}

export function GuideModeToggle() {
  const { guide, toggle } = useGuideMode();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggle}
      aria-pressed={guide}
      title={guide ? "Guide Mode is on — plain-English explanations shown" : "Guide Mode is off"}
      className={cn(guide && "bg-secondary text-foreground")}
    >
      <HelpCircle className="size-4" />
      <span className="hidden lg:inline">Guide{guide ? " on" : ""}</span>
    </Button>
  );
}

/**
 * Renders a label. In Guide Mode the label gets a dotted underline and a
 * plain-English tooltip; with Guide Mode off it renders exactly as before.
 */
export function InfoLabel({
  children,
  hint,
  className,
}: {
  children: ReactNode;
  hint: string;
  className?: string;
}) {
  const { guide } = useGuideMode();
  if (!guide) return <span className={className}>{children}</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "cursor-help underline decoration-dotted decoration-muted-foreground/60 underline-offset-4",
            className,
          )}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-relaxed">{hint}</TooltipContent>
    </Tooltip>
  );
}
