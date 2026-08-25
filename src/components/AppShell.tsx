import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  BookOpen,
  Building2,
  History,
  LogOut,
  Plug,
  Settings as SettingsIcon,
  ShieldCheck,
} from "lucide-react";

import { useQueryClient, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { GuideModeToggle } from "@/components/GuideMode";
import ptradesMark from "@/assets/ptrades-mark.png.asset.json";

/**
 * Mobile navigation is capped at five items on purpose: a sixth column makes the
 * labels truncate to unreadable stubs at ~360px. `/guide` is therefore reached
 * from the header Guide control (visible at every width) rather than the bottom
 * bar, and `/admin/*` stays in the header for the owner only.
 */
const MOBILE_NAV = [
  { to: "/feed", label: "Signal Feed", short: "Feed", icon: Activity },
  { to: "/history", label: "Trade History", short: "History", icon: History },
  { to: "/performance", label: "Performance", short: "Performance", icon: BarChart3 },
  // Public route, but it belongs in the terminal nav: signed-in users never see
  // the landing footer that used to be its only entry point.
  { to: "/connect", label: "Connect AI", short: "Connect", icon: Plug },
  { to: "/settings", label: "Settings", short: "Settings", icon: SettingsIcon },
] as const;

/**
 * From md up there is room for Broker accounts and the Guide entry inline. On
 * phones Accounts stays reachable from Settings → Account, because a sixth
 * bottom-bar column truncates every label at ~360px.
 */
const DESKTOP_NAV = [
  { to: "/feed", label: "Signal Feed", short: "Feed", icon: Activity },
  { to: "/history", label: "Trade History", short: "History", icon: History },
  { to: "/performance", label: "Performance", short: "Performance", icon: BarChart3 },
  { to: "/accounts", label: "Broker Accounts", short: "Accounts", icon: Building2 },
  { to: "/connect", label: "Connect AI", short: "Connect", icon: Plug },
  { to: "/settings", label: "Settings", short: "Settings", icon: SettingsIcon },
  { to: "/guide", label: "Guide", short: "Guide", icon: BookOpen },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Cosmetic gate only: the terminal itself is protected server-side and in SQL.
  const { data: isOwner } = useQuery({
    queryKey: ["is-owner"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return (data.user?.email ?? "").toLowerCase() === "boatengampomah@gmail.com";
    },
    staleTime: Infinity,
  });

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    try {
      await supabase.auth.signOut();
    } catch {
      // Network failure must not trap the user in the terminal: the local cache
      // is already cleared, so continue to the sign-in screen regardless.
    }
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-surface/95 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto max-w-[1600px] px-3 sm:px-4">
          {/* Phones: brand + account controls on top, nav on its own full-width row.
              From sm up this is the original single 56px row. */}
          <div className="flex h-14 items-center gap-3 sm:gap-6">
            <Link to="/feed" className="flex min-w-0 shrink-0 items-center gap-2">
              <img
                src={ptradesMark.url}
                alt="P-Trades Hub logo"
                width={28}
                height={28}
                className="size-7 shrink-0"
              />

              <span className="num hidden text-sm font-semibold tracking-tight md:inline">
                P-TRADES HUB
              </span>
            </Link>

            <nav className="hidden items-center gap-1 md:flex">
              {DESKTOP_NAV.map((item) => {
                const active = pathname.startsWith(item.to);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={cn(
                      "flex items-center gap-2 rounded-sm px-3 py-1.5 text-sm transition-colors",
                      active
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                    )}
                  >
                    <item.icon className="size-4 shrink-0" />
                    <span className="hidden lg:inline">{item.label}</span>
                    <span className="lg:hidden">{item.short}</span>
                  </Link>
                );
              })}
            </nav>

            <div className="ml-auto flex shrink-0 items-center gap-1">
              {isOwner ? (
                <Button variant="ghost" size="sm" asChild aria-label="Admin intelligence">
                  <Link to="/admin/intelligence">
                    <ShieldCheck className="size-4" />
                    <span className="hidden lg:inline">Admin</span>
                  </Link>
                </Button>
              ) : null}
              {/* Guide is not in the five-item mobile bar; this is its entry point there. */}
              <Button
                variant="ghost"
                size="sm"
                asChild
                aria-label="Guide and help"
                className="md:hidden"
              >
                <Link to="/guide">
                  <BookOpen className="size-4" />
                  <span className="hidden lg:inline">Guide</span>
                </Link>
              </Button>
              <GuideModeToggle />
              <Button
                variant="ghost"
                size="sm"
                aria-label="Sign out"
                onClick={() => void signOut()}
              >
                <LogOut className="size-4" />
                <span className="hidden lg:inline">Sign out</span>
              </Button>
            </div>
          </div>

          <nav className="grid grid-cols-5 border-t border-border md:hidden">
            {MOBILE_NAV.map((item) => {
              const active = pathname.startsWith(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-label={item.label}
                  className={cn(
                    "flex min-h-11 flex-col items-center justify-center gap-0.5 border-b-2 text-[11px] transition-colors",
                    active
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground",
                  )}
                >
                  <item.icon className="size-4" />
                  <span className="truncate px-1">{item.short}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-3 py-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:px-4 sm:py-6 sm:pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        {children}
      </main>
    </div>
  );
}
