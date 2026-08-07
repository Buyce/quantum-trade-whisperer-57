import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

import { requestAccountDeletion } from "@/lib/account.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function DangerZoneSection() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const cancelAccount = useServerFn(requestAccountDeletion);

  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [working, setWorking] = useState(false);

  async function onCancelAccount() {
    setWorking(true);
    try {
      await cancelAccount({ data: undefined });
      await queryClient.cancelQueries();
      queryClient.clear();
      await supabase.auth.signOut();
      toast.success("Account cancelled — sign in within 30 days to restore it");
      navigate({ to: "/auth", replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel the account");
      setWorking(false);
    }
  }

  return (
    <section className="space-y-3 rounded-md border border-destructive/40 bg-card p-4">
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 text-destructive" />
        <h2 className="label-xs text-destructive">Danger zone — cancel account</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Cancelling closes your access immediately and schedules your account for permanent deletion in{" "}
        <span className="num text-foreground">30 days</span>. Sign back in before then and everything — scanner
        preferences, trade journal, performance history — is restored in full. After 30 days it is deleted
        permanently and cannot be recovered.
      </p>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setConfirm("");
        }}
      >
        <DialogTrigger asChild>
          <Button variant="destructive">Cancel my account</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel your account?</DialogTitle>
            <DialogDescription>
              You&apos;ll be signed out now. Your data is kept for 30 days so you can restore the account simply by
              signing back in. After that it is permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label className="text-xs" htmlFor="confirm-cancel">
              Type CANCEL to confirm
            </Label>
            <Input
              id="confirm-cancel"
              className="num mt-2"
              autoComplete="off"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={working}>
              Keep my account
            </Button>
            <Button
              variant="destructive"
              disabled={confirm.trim() !== "CANCEL" || working}
              onClick={() => void onCancelAccount()}
            >
              {working ? "Cancelling…" : "Cancel account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
