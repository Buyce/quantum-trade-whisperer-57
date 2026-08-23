import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Link } from "@tanstack/react-router";
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

/**
 * A "Learn more" link into the in-app guide. Rendered only in Guide Mode so the
 * data-dense terminal stays dense for experienced users.
 *
 * `anchor` is a guide entry id (e.g. "confidence"), not a URL.
 */
export function GuideLink({
  anchor,
  children = "Learn more",
  className,
}: {
  anchor: string;
  children?: ReactNode;
  className?: string;
}) {
  const { guide } = useGuideMode();
  if (!guide) return null;
  return (
    <Link
      to="/guide"
      hash={anchor}
      className={cn("text-xs text-primary underline underline-offset-2", className)}
    >
      {children}
    </Link>
  );
}

/**
 * Guide-Mode-only explanatory panel. Use for a short paragraph that would be
 * noise to an experienced user but is essential context for a newcomer.
 */
export function GuideNote({
  children,
  anchor,
  className,
}: {
  children: ReactNode;
  anchor?: string;
  className?: string;
}) {
  const { guide } = useGuideMode();
  if (!guide) return null;
  return (
    <div
      className={cn(
        "rounded-sm border border-border bg-surface/60 p-3 text-xs leading-relaxed text-muted-foreground",
        className,
      )}
    >
      {children}
      {anchor ? <GuideLink anchor={anchor} className="ml-1" /> : null}
    </div>
  );
}

/**
 * Guide-Mode-only progressive disclosure using the terminal's standard
 * explanation frame: what it is / why it matters / what to do / what not to
 * assume, plus an optional deep link into the matching `/guide` section.
 *
 * Collapsed by default on purpose: this is a data-dense terminal, so an
 * explanation must be reachable in one tap without permanently occupying rows.
 * All four fields are optional; only those provided are rendered.
 */
export function GuideDetail({
  title,
  what,
  why,
  todo,
  assume,
  anchor,
  className,
}: {
  title: string;
  what?: string;
  why?: string;
  todo?: string;
  assume?: string;
  anchor?: string;
  className?: string;
}) {
  const { guide } = useGuideMode();
  const [open, setOpen] = useState(false);
  if (!guide) return null;

  const rows: [string, string | undefined][] = [
    ["What it is", what],
    ["Why it matters", why],
    ["What to do", todo],
    ["What not to assume", assume],
  ];
  const present = rows.filter((r): r is [string, string] => Boolean(r[1]));

  return (
    <div className={cn("text-xs", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex min-h-8 items-center gap-1.5 text-xs text-primary underline underline-offset-2"
      >
        <HelpCircle className="size-3.5" aria-hidden />
        {open ? `Hide: ${title}` : title}
      </button>
      {open ? (
        <dl className="mt-2 grid gap-2 rounded-sm border border-border bg-surface/60 p-3">
          {present.map(([k, v]) => (
            <div key={k} className="grid gap-0.5 sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:gap-3">
              <dt className="label-xs">{k}</dt>
              <dd className="leading-relaxed text-muted-foreground">{v}</dd>
            </div>
          ))}
          {anchor ? (
            <div>
              <GuideLink anchor={anchor}>Learn more →</GuideLink>
            </div>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}
