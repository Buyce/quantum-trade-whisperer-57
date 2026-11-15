import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  BookOpen,
  Bot,
  Building2,
  History,
  LogOut,
  Plug,
  Settings as SettingsIcon,
  ShieldCheck,
} from "lucide-react";

import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, type ReactNode } from "react";

import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { GuideModeToggle } from "@/components/GuideMode";
import { AssistantWidget } from "@/components/assistant/AssistantWidget";

import ptradesMark from "@/assets/ptrades-mark.png.asset.json";

/** One list for every width; the row scrolls sideways when it doesn't fit. */
const NAV = [
  { to: "/feed", label: "Signal Feed", short: "Feed", icon: Activity },
  { to: "/history", label: "Trade History", short: "History", icon: History },
  { to: "/performance", label: "Performance", short: "Performance", icon: BarChart3 },
  { to: "/accounts", label: "Broker Accounts", short: "Accounts", icon: Building2 },
  { to: "/assistant", label: "Assistant", short: "Assistant", icon: Bot },
  { to: "/connect", label: "Connect AI", short: "Connect", icon: Plug },
  { to: "/settings", label: "Settings", short: "Settings", icon: SettingsIcon },
  { to: "/guide", label: "Guide", short: "Guide", icon: BookOpen },
] as const;

function NavRow({ pathname, className }: { pathname: string; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [pathname]);
  return (
    <nav
      ref={ref}
      aria-label="Main"
      className={cn(
        "flex snap-x items-center gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {NAV.map((item) => {
        const active = pathname.startsWith(item.to);
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-label={item.label}
            data-active={active}
            className={cn(
              "flex shrink-0 snap-start items-center gap-1.5 whitespace-nowrap rounded-sm px-3 py-2 text-sm transition-colors",
              active
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
            )}
          >
            <item.icon className="size-4 shrink-0" />
            <span className="hidden xl:inline">{item.label}</span>
            <span className="xl:hidden">{item.short}</span>
          </Link>
        );
      })}
    </nav>
  );
}

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

            <NavRow
              pathname={pathname}
              className="hidden min-w-0 flex-1 lg:flex [mask-image:linear-gradient(to_right,black_92%,transparent)]"
            />

            <div className="ml-auto flex shrink-0 items-center gap-1">
              {isOwner ? (
                <Button variant="ghost" size="sm" asChild aria-label="Admin intelligence">
                  <Link to="/admin/intelligence">
                    <ShieldCheck className="size-4" />
                    <span className="hidden lg:inline">Admin</span>
                  </Link>
                </Button>
              ) : null}
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

          <NavRow
            pathname={pathname}
            className="-mx-3 border-t border-border px-2 py-1 sm:-mx-4 lg:hidden [mask-image:linear-gradient(to_right,black_90%,transparent)]"
          />
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-3 py-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:px-4 sm:py-6 sm:pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        {children}
      </main>

      {/* Ask-anywhere launcher. Hidden on the Assistant page itself, which already
          renders the same conversation surface full-screen. */}
      {!pathname.startsWith("/assistant") && <AssistantWidget />}
    </div>
  );
}
