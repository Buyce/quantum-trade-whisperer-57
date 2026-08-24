/**
 * Resolve the operator-owned benchmark account at the regional API boundary.
 *
 * The benchmark id is stable, but its region is provider-owned metadata. A
 * manually maintained region secret can drift after an account replacement or
 * migration. We keep the configured region as the fast path and only consult
 * the global Provisioning API after a regional GET returns 404. MetaApi itself
 * documents that a wrong regional host is surfaced as 404.
 */
import { readBenchmarkAccount, type BenchmarkAccountConfig } from "./config.server";
import { MetaApiHttpError, MetaApiNotConfiguredError } from "./errors";
import { isValidRegion } from "./hosts";
import { fetchProvisionedAccount } from "./provision.server";

type BenchmarkRead<T> = (account: BenchmarkAccountConfig) => Promise<T>;

let recoveredRegion: { accountId: string; region: string } | null = null;

function accountWithRecoveredRegion(configured: BenchmarkAccountConfig): BenchmarkAccountConfig {
  if (recoveredRegion?.accountId !== configured.accountId) return configured;
  return { ...configured, region: recoveredRegion.region };
}

/** Test-only reset for the worker-local recovery cache. */
export function resetRecoveredBenchmarkRegion(): void {
  recoveredRegion = null;
}

/**
 * Run one idempotent benchmark read and self-correct a stale region once.
 *
 * No mutation is ever replayed here. If the account id itself is absent, the
 * global Provisioning API remains authoritative and its 404 is allowed to fail
 * the scan instead of guessing another account.
 */
export async function withBenchmarkAccount<T>(read: BenchmarkRead<T>): Promise<T> {
  const configured = readBenchmarkAccount();
  const initial = accountWithRecoveredRegion(configured);

  try {
    return await read(initial);
  } catch (err) {
    if (!(err instanceof MetaApiHttpError) || err.status !== 404) throw err;

    const remote = await fetchProvisionedAccount(configured.accountId);
    const authoritativeRegion = remote?.region?.trim() ?? "";
    if (!isValidRegion(authoritativeRegion)) {
      throw new MetaApiNotConfiguredError("the benchmark account's authoritative MetaApi region");
    }

    if (authoritativeRegion === initial.region) {
      // The region was already correct, so this is a genuine missing/not-yet-
      // provisioned market-data resource rather than configuration drift.
      throw err;
    }

    recoveredRegion = { accountId: configured.accountId, region: authoritativeRegion };
    return await read({ ...configured, region: authoritativeRegion });
  }
}
