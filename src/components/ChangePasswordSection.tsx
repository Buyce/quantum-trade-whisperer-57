import { useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  isPasswordlessAccount,
  validateNewPassword,
  PASSWORD_MAX_LENGTH,
} from "@/lib/auth/password";

/**
 * Signed-in password change. The current password is required by the auth
 * configuration, so a stolen session alone cannot lock the owner out.
 */
export function ChangePasswordSection() {
  const [providers, setProviders] = useState<string[] | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      const list = (data.user?.identities ?? []).map((i) => i.provider);
      setProviders(list);
    });
    return () => {
      active = false;
    };
  }, []);

  async function submit() {
    const check = validateNewPassword(next, confirm);
    if (!check.ok) {
      toast.error(check.message);
      return;
    }
    if (current.length === 0) {
      toast.error("Enter your current password");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({
      password: next,
      // Accepted by the auth API even where typings predate the field.
      ...({ current_password: current } as Record<string, string>),
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setCurrent("");
    setNext("");
    setConfirm("");
    toast.success("Password updated");
  }

  const googleOnly = providers !== null && isPasswordlessAccount(providers);

  return (
    <section className="space-y-4 rounded-md border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <KeyRound className="size-4 text-muted-foreground" />
        <h2 className="label-xs">Change password</h2>
      </div>

      {googleOnly ? (
        <p className="text-xs text-muted-foreground">
          You sign in with Google, so your password is managed by your Google account. Change it
          there and it applies here straight away.
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Enter your current password, then choose a new one of at least 8 characters. You stay
            signed in on this device.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <PasswordField
              id="current-password"
              label="Current password"
              value={current}
              onChange={setCurrent}
              autoComplete="current-password"
            />
            <PasswordField
              id="account-new-password"
              label="New password"
              value={next}
              onChange={setNext}
              autoComplete="new-password"
            />
            <PasswordField
              id="account-confirm-password"
              label="Confirm new password"
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
            />
          </div>
          <div className="flex justify-end">
            <Button size="sm" disabled={busy} onClick={() => void submit()}>
              Update password
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="label-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="password"
        value={value}
        autoComplete={autoComplete}
        maxLength={PASSWORD_MAX_LENGTH}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
