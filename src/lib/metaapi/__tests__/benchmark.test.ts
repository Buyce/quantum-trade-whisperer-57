import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MetaApiHttpError, MetaApiNotConfiguredError } from "../errors";

const mocks = vi.hoisted(() => ({
  fetchProvisionedAccount: vi.fn(),
}));

vi.mock("../provision.server", () => ({
  fetchProvisionedAccount: mocks.fetchProvisionedAccount,
}));

import { resetRecoveredBenchmarkRegion, withBenchmarkAccount } from "../benchmark.server";

describe("benchmark account region recovery", () => {
  beforeEach(() => {
    process.env["PTRADES_BENCHMARK_METAAPI_ACCOUNT_ID"] = "benchmark-account";
    process.env["PTRADES_BENCHMARK_METAAPI_REGION"] = "london";
    process.env["PTRADES_BENCHMARK_MAGIC"] = "140714";
    mocks.fetchProvisionedAccount.mockReset();
    resetRecoveredBenchmarkRegion();
  });

  afterEach(() => {
    delete process.env["PTRADES_BENCHMARK_METAAPI_ACCOUNT_ID"];
    delete process.env["PTRADES_BENCHMARK_METAAPI_REGION"];
    delete process.env["PTRADES_BENCHMARK_MAGIC"];
  });

  it("[UNIT] keeps the configured region when the regional read succeeds", async () => {
    const read = vi.fn(async ({ region }: { region: string }) => region);

    await expect(withBenchmarkAccount(read)).resolves.toBe("london");
    expect(mocks.fetchProvisionedAccount).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("[INVARIANT] retries a safe read using MetaApi's authoritative region after 404", async () => {
    const read = vi.fn(async ({ region }: { region: string }) => {
      if (region === "london") throw new MetaApiHttpError(404, "XAUUSD H4", "not found");
      return region;
    });
    mocks.fetchProvisionedAccount.mockResolvedValue({
      _id: "benchmark-account",
      region: "new-york",
    });

    await expect(withBenchmarkAccount(read)).resolves.toBe("new-york");
    expect(read.mock.calls.map(([account]) => account.region)).toEqual(["london", "new-york"]);
    expect(mocks.fetchProvisionedAccount).toHaveBeenCalledWith("benchmark-account");
  });

  it("[INVARIANT] caches a recovered region without trusting a different account id", async () => {
    const first = vi.fn(async ({ region }: { region: string }) => {
      if (region === "london") throw new MetaApiHttpError(404, "EURUSD H4", "not found");
      return region;
    });
    mocks.fetchProvisionedAccount.mockResolvedValue({
      _id: "benchmark-account",
      region: "new-york",
    });
    await withBenchmarkAccount(first);

    const second = vi.fn(async ({ region }: { region: string }) => region);
    await expect(withBenchmarkAccount(second)).resolves.toBe("new-york");
    expect(mocks.fetchProvisionedAccount).toHaveBeenCalledTimes(1);
  });

  it("[INVARIANT] refuses malformed provider region metadata", async () => {
    mocks.fetchProvisionedAccount.mockResolvedValue({
      _id: "benchmark-account",
      region: "evil.example.com",
    });

    await expect(
      withBenchmarkAccount(async () => {
        throw new MetaApiHttpError(404, "XAUUSD H4", "not found");
      }),
    ).rejects.toBeInstanceOf(MetaApiNotConfiguredError);
  });

  it("[INVARIANT] never treats a non-404 failure as region drift", async () => {
    const failure = new MetaApiHttpError(504, "XAUUSD H4", "gateway timeout");

    await expect(
      withBenchmarkAccount(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(mocks.fetchProvisionedAccount).not.toHaveBeenCalled();
  });
});
