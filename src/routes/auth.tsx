import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
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

/** The panes of this route. */
type AuthMode = "signin" | "signup" | "forgot";

const COPY: Record<AuthMode, { title: string; heading: string; description: string }> = {
  signin: {
    title: "Sign in — P-Trades Hub",
    heading: "Sign in to the P-Trades Hub terminal",
    description: "Sign in or create an account to access the P-Trades Hub forex scanner terminal.",
  },
  signup: {
    title: "Create your account — P-Trades Hub",
    heading: "Create your P-Trades Hub account",
    description:
      "Create a free P-Trades Hub account to open the quantitative forex scanner terminal.",
  },
  forgot: {
    title: "Reset your password — P-Trades Hub",
    heading: "Reset your password",
    description: "Request a password reset link for your P-Trades Hub terminal account.",
  },
};

export const Route = createFileRoute("/auth")({
  head: ({ match }) => {
    const raw = match.search.mode;
    const mode: AuthMode = raw === "signup" || raw === "forgot" ? raw : "signin";
    const copy = COPY[mode];
    return {
      meta: [
        { title: copy.title },
        { name: "description", content: copy.description },
        { property: "og:title", content: copy.title },
        { property: "og:description", content: copy.description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
        // Signed-out authentication is intentionally kept out of the index:
        // it carries no content a searcher wants and is absent from the sitemap.
        { name: "robots", content: "noindex" },
      ],
    };
  },
  /**
   * `next` is a post-login redirect; `mode` selects which pane opens. Anything
   * other than a known pane name collapses to sign-in, so a hand-edited or
   * stale URL can never land the user on an unexpected pane.
   */
  validateSearch: (s: Record<string, unknown>): { next?: string; mode?: "signup" | "forgot" } => ({
    ...(typeof s["next"] === "string" ? { next: s["next"] } : {}),
    ...(s["mode"] === "signup" || s["mode"] === "forgot"
      ? { mode: s["mode"] as "signup" | "forgot" }
      : {}),
  }),

  component: AuthPage,
});

/** Only same-origin relative paths may be used as a post-login redirect. */
function safeNext(next: string | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

const credentials = z.object({
  email: z.string().trim().email({ message: "Enter a valid email address" }).max(255),
  password: z.string().min(8, { message: "Password must be at least 8 characters" }).max(72),
});

function AuthPage() {
  const navigate = useNavigate();
  const { next, mode } = Route.useSearch();
  const nextPath = safeNext(next);
  const initialMode: AuthMode =
    mode === "signup" || mode === "forgot" ? (mode as AuthMode) : "signin";

  // Controlled so a direct link, a refresh and an in-page tab click all agree,
  // while the URL keeps carrying the chosen pane for the confirmation return.
  const [pane, setPane] = useState<AuthMode>(initialMode);
  useEffect(() => setPane(initialMode), [initialMode]);
  const afterAuth = useCallback(() => {
    if (nextPath) {
      window.location.href = nextPath;
      return;
    }
    navigate({ to: "/feed", replace: true });
  }, [navigate, nextPath]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) afterAuth();
    });
  }, [afterAuth]);

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
    afterAuth();
  }

  async function sendReset() {
    const parsed = z.string().trim().email().safeParse(email);
    if (!parsed.success) {
      toast.error("Enter a valid email address");
      return;
    }
    setBusy(true);
    // The outcome is deliberately not reported back: whether an address has an
    // account is not something this screen may reveal.
    await supabase.auth.resetPasswordForEmail(parsed.data, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    setResetSent(true);
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
        emailRedirectTo: nextPath
          ? `${window.location.origin}/auth?next=${encodeURIComponent(nextPath)}`
          : `${window.location.origin}/auth`,
        data: { display_name: displayName.trim().slice(0, 60) || parsed.data.email.split("@")[0] },
      },
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (data.session) {
      afterAuth();
      return;
    }
    setAwaitingConfirm(true);
  }

  async function google() {
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      // Return to the public /auth route: it waits for the session, then
      // forwards straight to /feed. Returning into the protected subtree
      // before the session is written would bounce back to sign-in.
      redirect_uri: nextPath
        ? `${window.location.origin}/auth?next=${encodeURIComponent(nextPath)}`
        : `${window.location.origin}/auth`,
    });
    if (result.error) {
      setBusy(false);
      toast.error("Google sign-in failed. Please try again.");
      return;
    }
    if (result.redirected) return;
    afterAuth();
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
              {COPY[pane].heading}
            </h1>
          </CardHeader>
          <CardContent>
            {pane === "forgot" ? (
              <div className="space-y-4">
                {resetSent ? (
                  <div className="space-y-3 text-sm">
                    <p className="text-foreground">Check your email.</p>
                    <p className="text-muted-foreground">
                      If <span className="num">{email}</span> has an account, a reset link is on its
                      way. The link can be used once and expires after a short time.
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Enter the email address on your account and we&apos;ll send you a link to
                      choose a new password.
                    </p>
                    <Field
                      label="Email"
                      value={email}
                      onChange={setEmail}
                      type="email"
                      autoComplete="email"
                    />
                    <Button className="w-full" disabled={busy} onClick={() => void sendReset()}>
                      Send reset link
                    </Button>
                  </>
                )}
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setResetSent(false);
                    setPane("signin");
                    void navigate({ to: "/auth", search: {}, replace: true });
                  }}
                >
                  Back to sign in
                </Button>
              </div>
            ) : awaitingConfirm ? (
              <div className="space-y-3 text-sm">
                <p className="text-foreground">Check your email to confirm your account.</p>
                <p className="text-muted-foreground">
                  We sent a confirmation link to <span className="num">{email}</span>. Once
                  confirmed you can sign in and the terminal will open.
                </p>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setAwaitingConfirm(false);
                    setPane("signin");
                  }}
                >
                  Back to sign in
                </Button>
              </div>
            ) : (
              <Tabs
                value={pane}
                onValueChange={(v) => setPane(v === "signup" ? "signup" : "signin")}
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="signin">Sign in</TabsTrigger>
                  <TabsTrigger value="signup">Create account</TabsTrigger>
                </TabsList>

                <TabsContent value="signin" className="mt-4 space-y-4">
                  <Field
                    label="Email"
                    value={email}
                    onChange={setEmail}
                    type="email"
                    autoComplete="email"
                  />
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
                  <button
                    type="button"
                    className="w-full text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
                    onClick={() => {
                      setResetSent(false);
                      setPane("forgot");
                    }}
                  >
                    Forgot your password?
                  </button>
                </TabsContent>

                <TabsContent value="signup" className="mt-4 space-y-4">
                  <Field
                    label="Display name"
                    value={displayName}
                    onChange={setDisplayName}
                    type="text"
                  />
                  <Field
                    label="Email"
                    value={email}
                    onChange={setEmail}
                    type="email"
                    autoComplete="email"
                  />
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
