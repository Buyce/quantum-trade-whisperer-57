/**
 * Floating "Ask" launcher that opens the assistant over the current page.
 *
 * It renders the shared AssistantPanel, so it is the same conversation, the same
 * tools and the same settings-approval flow as the full Assistant page. The
 * active thread is remembered per browser so context carries across pages, and
 * the panel only mounts for a signed-in session.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { MessageCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";
import { createAssistantThread, listAssistantThreads } from "@/lib/assistant/threads.functions";

const STORAGE_KEY = "ptrades.assistant.widget.thread";

export function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resolveThread = useCallback(async () => {
    setError(null);
    try {
      const remembered =
        typeof window === "undefined" ? null : window.localStorage.getItem(STORAGE_KEY);
      const threads = await listAssistantThreads();
      const existing = remembered ? threads.find((thread) => thread.id === remembered) : threads[0];
      if (existing) {
        setThreadId(existing.id);
        window.localStorage.setItem(STORAGE_KEY, existing.id);
        return;
      }
      const created = await createAssistantThread();
      setThreadId(created.id);
      window.localStorage.setItem(STORAGE_KEY, created.id);
    } catch (resolveError) {
      setError(
        resolveError instanceof Error
          ? resolveError.message
          : "Could not open the assistant right now.",
      );
    }
  }, []);

  useEffect(() => {
    if (!open || threadId !== null) return;
    void resolveThread();
  }, [open, threadId, resolveThread]);

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ask the P-Trades assistant"
        className="fixed bottom-20 right-4 z-40 h-12 gap-2 rounded-full shadow-lg sm:bottom-6"
      >
        <MessageCircle className="h-5 w-5" aria-hidden="true" />
        <span className="hidden sm:inline">Ask</span>
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="flex-row items-center justify-between border-b border-border p-4">
            <SheetTitle className="text-base">P-Trades Assistant</SheetTitle>
            <div className="flex items-center gap-2">
              {threadId && (
                <Link
                  to="/assistant/$threadId"
                  params={{ threadId }}
                  className="text-xs text-primary underline"
                  onClick={() => setOpen(false)}
                >
                  Open full page
                </Link>
              )}
              <button
                type="button"
                aria-label="Close assistant"
                onClick={() => setOpen(false)}
                className="text-muted-foreground"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </SheetHeader>
          {error ? (
            <p className="p-4 text-sm text-muted-foreground">{error}</p>
          ) : threadId ? (
            <AssistantPanel threadId={threadId} className="h-[calc(100dvh-4.5rem)]" />
          ) : (
            <p className="p-4 text-sm text-muted-foreground">Opening your conversation…</p>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
