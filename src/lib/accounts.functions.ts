/**
 * Connected broker account server functions.
 *
 * Thin wrappers only: every runtime helper lives in
 * `@/lib/accounts/provision.server` and is loaded inside the handler, so the
 * service-role client can never reach a client bundle.
 *
 * Ownership is taken from the verified bearer token (`context.userId`) and never
 * from the request body.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AccountQuotaView, ConnectedAccountView } from "@/lib/accounts/types";

export const listConnectedAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ConnectedAccountView[]> => {
    const { loadAccountViews } = await import("@/lib/accounts/read.server");
    return await loadAccountViews(context.supabase, context.userId);
  });

export const getAccountQuota = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AccountQuotaView> => {
    const { loadQuota } = await import("@/lib/accounts/read.server");
    return await loadQuota(context.userId);
  });

export const startBrokerConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      label: string;
      platform: "mt4" | "mt5";
      brokerServer: string;
      region: string;
      intent: "demo" | "live";
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const { startConnection } = await import("@/lib/accounts/provision.server");
    return await startConnection({ ...data, userId: context.userId });
  });

export const reissueBrokerConfigurationLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { accountId: string }) => input)
  .handler(async ({ data, context }) => {
    const { reissueConfigurationLink } = await import("@/lib/accounts/provision.server");
    return await reissueConfigurationLink(context.userId, data.accountId);
  });

export const refreshBrokerConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { accountId: string }) => input)
  .handler(async ({ data, context }): Promise<ConnectedAccountView | null> => {
    const { reconcileConnection } = await import("@/lib/accounts/provision.server");
    const { toAccountView } = await import("@/lib/accounts/read.server");
    const row = await reconcileConnection(context.userId, data.accountId);
    return await toAccountView(context.supabase, row);
  });

export const disconnectBrokerConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { accountId: string }) => input)
  .handler(async ({ data, context }) => {
    const { disconnectConnection } = await import("@/lib/accounts/provision.server");
    return await disconnectConnection(context.userId, data.accountId);
  });

export const resolveAmbiguousSymbol = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { accountId: string; canonicalSymbol: string; brokerSymbol: string }) => input,
  )
  .handler(async ({ data, context }) => {
    const { chooseBrokerSymbol } = await import("@/lib/accounts/provision.server");
    return await chooseBrokerSymbol(context.userId, data);
  });

export const setBrokerAccountMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { accountId: string; mode: string }) => input)
  .handler(async ({ data, context }): Promise<ConnectedAccountView | null> => {
    const { setAccountMode } = await import("@/lib/accounts/arm.server");
    const { loadAccountViews } = await import("@/lib/accounts/read.server");
    await setAccountMode(context.userId, data.accountId, data.mode);
    const views = await loadAccountViews(context.supabase, context.userId);
    return views.find((v) => v.id === data.accountId) ?? null;
  });

export const setAccountExposureBoundary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { accountId: string; maxOpenPositions: number | null }) => input)
  .handler(async ({ data, context }): Promise<ConnectedAccountView | null> => {
    const { setAccountExposureBoundary: save } = await import("@/lib/accounts/exposure.server");
    const { loadAccountViews } = await import("@/lib/accounts/read.server");
    await save(context.userId, data.accountId, data.maxOpenPositions);
    const views = await loadAccountViews(context.supabase, context.userId);
    return views.find((v) => v.id === data.accountId) ?? null;
  });

export const setAccountResearchConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { accountId: string; enabled: boolean }) => input)
  .handler(async ({ data, context }) => {
    const { setResearchConsent } = await import("@/lib/accounts/research-consent.server");
    return await setResearchConsent(context.userId, data.accountId, data.enabled);
  });
