/**
 * Bottom sheet on phones, side panel on desktop. Explains a signal or pasted
 * notes with Lovable AI; rule checks come from code, not the model.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { explainSetup, type SetupExplanation } from "@/lib/explain.functions";

export function ExplainSetupSheet({
  signalId,
  trigger,
}: {
  signalId: string | null;
  trigger: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  const explain = useServerFn(explainSetup);
  const [text, setText] = useState("");
  const m = useMutation({
    mutationFn: () => explain({ data: { signalId, text: text.trim() || null } }),
  });
  const r: SetupExplanation | undefined = m.data;

  return (
    <Sheet>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={isMobile ? "max-h-[85vh] overflow-y-auto" : "w-full overflow-y-auto sm:max-w-md"}
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="size-4" /> Explain this setup
          </SheetTitle>
        </SheetHeader>
        <div className="mt-3 space-y-3 px-4 pb-6 text-sm">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              signalId
                ? "Optional: add your own reasoning or what you see on the chart"
                : "Paste a signal, market snapshot or your trade rationale"
            }
            rows={4}
            maxLength={6000}
          />
          <Button
            className="w-full"
            disabled={m.isPending || (!signalId && !text.trim())}
            onClick={() => m.mutate()}
          >
            {m.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {m.isPending ? "Thinking…" : "Explain"}
          </Button>
          {m.error ? <p className="text-xs text-destructive">{m.error.message}</p> : null}
          {r ? (
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                AI explanation — not a trade instruction
              </p>
              <p>{r.summary}</p>
              <div>
                <p className="font-medium">Risk factors</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-xs">
                  {r.riskFactors.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              </div>
              <div>
                <p className="font-medium">Your rules</p>
                <ul className="mt-1 space-y-1 text-xs">
                  {r.ruleChecks.map((c, i) => (
                    <li key={i} className="flex gap-2">
                      <Badge
                        variant={c.status === "conflict" ? "destructive" : c.status === "ok" ? "secondary" : "outline"}
                        className="shrink-0"
                      >
                        {c.status === "conflict" ? "Conflict" : c.status === "ok" ? "OK" : "Unknown"}
                      </Badge>
                      <span><strong>{c.rule}.</strong> {c.detail}</span>
                    </li>
                  ))}
                </ul>
                {r.ruleNotes ? <p className="mt-2 text-xs text-muted-foreground">{r.ruleNotes}</p> : null}
              </div>
              {r.dataGaps.length ? (
                <div>
                  <p className="font-medium">Missing information</p>
                  <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                    {r.dataGaps.map((g, i) => <li key={i}>{g}</li>)}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
