import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { recoveryState, validateNewPassword, PASSWORD_MAX_LENGTH } from "@/lib/auth/password";
import ptradesMark from "@/assets/ptrades-mark.png.asset.json";

const TITLE = "Choose a new password — P-Trades Hub";
const DESCRIPTION = "Set a new password for your P-Trades Hub terminal account.";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      // A single-use recovery link carries nothing a searcher wants.
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [hasSession, setHasSession] = useState(false);
  const [checked, setChecked] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;

    // Supabase writes the recovery session from the URL fragment; the listener
    // catches it whether it lands before or after the first read.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active || !session) return;
      setHasSession(true);
      setChecked(true);
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setHasSession(!!data.session);
      setChecked(true);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const state = recoveryState(hasSession, checked);

  async function submit() {
    const check = validateNewPassword(password, confirm);
    if (!check.ok) {
      toast.error(check.message);
      return;
    }
    setBusy(true);
    // A recovery session is exempt from the current-password requirement.
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Password updated");
    navigate({ to: "/feed", replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2">
          <img
            src={ptradesMark.url}
            alt="P-Trades Hub logo"
            width={28}
            height={28}
            className="size-7"
          />
          <span className="num text-sm font-semibold">P-TRADES HUB</span>
        </Link>

        <Card>
          <CardHeader>
            <h1 className="text-lg font-semibold leading-none tracking-tight">
              Choose a new password
            </h1>
          </CardHeader>
          <CardContent>
            {state === "waiting" ? (
              <p className="text-sm text-muted-foreground">Checking your reset link…</p>
            ) : state === "expired" ? (
              <div className="space-y-3 text-sm">
                <p className="text-foreground">This reset link is no longer valid.</p>
                <p className="text-muted-foreground">
                  Reset links can only be used once and expire after a short time. Request a new one
                  and it will arrive by email.
                </p>
                <Button asChild variant="outline" className="w-full">
                  <Link to="/auth" search={{ mode: "forgot" }}>
                    Request a new link
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Use at least 8 characters, up to {PASSWORD_MAX_LENGTH}.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="new-password" className="label-xs">
                    New password
                  </Label>
                  <Input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    maxLength={PASSWORD_MAX_LENGTH}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-password" className="label-xs">
                    Confirm new password
                  </Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    maxLength={PASSWORD_MAX_LENGTH}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </div>
                <Button className="w-full" disabled={busy} onClick={() => void submit()}>
                  Save new password
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
