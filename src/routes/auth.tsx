import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ptradesMark from "@/assets/ptrades-mark.png.asset.json";


export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — P-Trades Hub" },
      {
        name: "description",
        content: "Sign in or create an account to access the P-Trades Hub forex scanner terminal.",
      },
      { property: "og:title", content: "Sign in — P-Trades Hub" },
      { property: "og:description", content: "Access your P-Trades Hub quantitative forex terminal." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

const credentials = z.object({
  email: z.string().trim().email({ message: "Enter a valid email address" }).max(255),
  password: z.string().min(8, { message: "Password must be at least 8 characters" }).max(72),
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/feed", replace: true });
    });
  }, [navigate]);

  async function signIn() {
    const parsed = credentials.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid credentials");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    navigate({ to: "/feed", replace: true });
  }

  async function signUp() {
    const parsed = credentials.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid credentials");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      ...parsed.data,
      options: {
        emailRedirectTo: window.location.origin,
        data: { display_name: displayName.trim().slice(0, 60) || parsed.data.email.split("@")[0] },
      },
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (data.session) {
      navigate({ to: "/feed", replace: true });
      return;
    }
    setAwaitingConfirm(true);
  }

  async function google() {
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setBusy(false);
      toast.error("Google sign-in failed. Please try again.");
      return;
    }
    if (result.redirected) return;
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
              Sign in to the P-Trades Hub terminal
            </h1>
          </CardHeader>
          <CardContent>
            {awaitingConfirm ? (
              <div className="space-y-3 text-sm">
                <p className="text-foreground">Check your email to confirm your account.</p>
                <p className="text-muted-foreground">
                  We sent a confirmation link to <span className="num">{email}</span>. Once confirmed you
                  can sign in and the terminal will open.
                </p>
                <Button variant="outline" className="w-full" onClick={() => setAwaitingConfirm(false)}>
                  Back to sign in
                </Button>
              </div>
            ) : (
              <Tabs defaultValue="signin">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="signin">Sign in</TabsTrigger>
                  <TabsTrigger value="signup">Create account</TabsTrigger>
                </TabsList>

                <TabsContent value="signin" className="mt-4 space-y-4">
                  <Field label="Email" value={email} onChange={setEmail} type="email" autoComplete="email" />
                  <Field
                    label="Password"
                    value={password}
                    onChange={setPassword}
                    type="password"
                    autoComplete="current-password"
                  />
                  <Button className="w-full" disabled={busy} onClick={() => void signIn()}>
                    Sign in
                  </Button>
                </TabsContent>

                <TabsContent value="signup" className="mt-4 space-y-4">
                  <Field label="Display name" value={displayName} onChange={setDisplayName} type="text" />
                  <Field label="Email" value={email} onChange={setEmail} type="email" autoComplete="email" />
                  <Field
                    label="Password"
                    value={password}
                    onChange={setPassword}
                    type="password"
                    autoComplete="new-password"
                  />
                  <Button className="w-full" disabled={busy} onClick={() => void signUp()}>
                    Create account
                  </Button>
                </TabsContent>

                <div className="mt-4 flex items-center gap-3">
                  <span className="h-px flex-1 bg-border" />
                  <span className="label-xs">or</span>
                  <span className="h-px flex-1 bg-border" />
                </div>

                <Button
                  variant="outline"
                  className="mt-4 w-full"
                  disabled={busy}
                  onClick={() => void google()}
                >
                  Continue with Google
                </Button>
              </Tabs>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type: string;
  autoComplete?: string;
}) {
  const id = `field-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="label-xs">
        {label}
      </Label>
      <Input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        maxLength={255}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
