import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { RotateCcw, X } from "lucide-react";

import { cancelAccountDeletion } from "@/lib/account.functions";
import { Button } from "@/components/ui/button";

/**
 * Signing back in during the 30-day grace period reverses a pending account
 * cancellation automatically. Runs once per session mount.
 */
export function AccountRestoreBanner() {
  const restore = useServerFn(cancelAccountDeletion);
  const [restored, setRestored] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let active = true;
    void restore({ data: undefined })
      .then((result) => {
        if (active && result.restored) setRestored(true);
      })
      .catch(() => {
        /* non-blocking */
      });
    return () => {
      active = false;
    };
  }, [restore]);

  if (!restored || dismissed) return null;

  return (
    <div className="mb-4 flex items-start gap-3 rounded-md border border-primary/40 bg-primary/10 p-3">
      <RotateCcw className="mt-0.5 size-4 text-primary" />
      <div className="flex-1">
        <p className="text-sm font-medium text-foreground">Your account cancellation was reversed</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Welcome back — your scanner preferences, trade journal and performance history are intact.
        </p>
      </div>
      <Button variant="ghost" size="sm" aria-label="Dismiss notice" onClick={() => setDismissed(true)}>
        <X className="size-4" />
      </Button>
    </div>
  );
}
