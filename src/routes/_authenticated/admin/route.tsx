import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

const OWNER_EMAIL = "boatengampomah@gmail.com";

/**
 * Owner-only subtree. This gate is UX plus bundle isolation — the real security
 * boundary is the email check inside the server function and the SQL guard in
 * `get_admin_intelligence()`, both of which read the verified bearer token.
 */
export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if ((data.user?.email ?? "").toLowerCase() !== OWNER_EMAIL) {
      throw redirect({ to: "/feed" });
    }
  },
  component: () => <Outlet />,
});
