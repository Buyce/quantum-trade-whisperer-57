/**
 * SSRF suite. Every case here is a way an attacker (or a well-meaning user with
 * a self-hosted bridge) turns our worker into a request forger, so each one must
 * be refused with a NAMED reason — never accepted "just this once".
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { inspectUrlSyntax, isPublicAddress, validateOutboundUrl } from "../outbound-url.server";

function dohResponse(addresses: string[], type: "A" | "AAAA") {
  return {
    ok: true,
    json: async () => ({
      Status: 0,
      Answer: addresses.map((data) => ({ type: type === "A" ? 1 : 28, data })),
    }),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isPublicAddress", () => {
  it("[INVARIANT] rejects every non-public range", () => {
    for (const addr of [
      "0.0.0.0",
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "224.0.0.1",
      "255.255.255.255",
      "::",
      "::1",
      "fe80::1",
      "fd00::1",
      "ff02::1",
      "::ffff:169.254.169.254",
      "::ffff:127.0.0.1",
    ]) {
      expect(isPublicAddress(addr), addr).toBe(false);
    }
  });

  it("[INVARIANT] accepts public addresses", () => {
    for (const addr of ["8.8.8.8", "1.1.1.1", "104.18.32.7", "2606:4700::1111"]) {
      expect(isPublicAddress(addr), addr).toBe(true);
    }
  });
});

describe("inspectUrlSyntax", () => {
  it("[INVARIANT] rejects http", () => {
    const r = inspectUrlSyntax("http://bridge.example.com/hook");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("scheme_not_https");
  });

  it("[INVARIANT] rejects userinfo", () => {
    const r = inspectUrlSyntax("https://user:pass@bridge.example.com/hook");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("userinfo_present");
  });

  it("[INVARIANT] rejects non-443 ports", () => {
    const r = inspectUrlSyntax("https://bridge.example.com:8443/hook");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("port_not_443");
  });

  it("[INVARIANT] rejects localhost and internal suffixes", () => {
    for (const url of [
      "https://localhost/hook",
      "https://metadata.google.internal/hook",
      "https://bridge.local/hook",
      "https://svc.internal/hook",
    ]) {
      const r = inspectUrlSyntax(url);
      expect(r.ok, url).toBe(false);
      if (!r.ok) expect(r.reason).toBe("hostname_blocklisted");
    }
  });

  it("[INVARIANT] rejects private IP literals without touching DNS", () => {
    for (const url of ["https://127.0.0.1/hook", "https://[::1]/hook", "https://10.0.0.5/hook"]) {
      const r = inspectUrlSyntax(url);
      expect(r.ok, url).toBe(false);
      if (!r.ok) expect(r.reason).toBe("hostname_is_ip_literal_private");
    }
  });

  it("[INVARIANT] accepts a plain https endpoint", () => {
    expect(inspectUrlSyntax("https://bridge.example.com/hook").ok).toBe(true);
  });
});

describe("validateOutboundUrl", () => {
  it("[INVARIANT] accepts a hostname resolving only to public addresses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) =>
        String(input).includes("type=A&") || String(input).endsWith("type=A")
          ? dohResponse(["104.18.32.7"], "A")
          : dohResponse([], "AAAA"),
      ),
    );
    const r = await validateOutboundUrl("https://bridge.example.com/hook");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.addresses).toContain("104.18.32.7");
  });

  it("[INVARIANT] rejects a hostname that resolves into private space (DNS rebind attempt)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => dohResponse(["10.0.0.7"], "A")),
    );
    const r = await validateOutboundUrl("https://rebind.example.com/hook");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("resolves_to_private_address");
  });

  it("[INVARIANT] rejects when only the AAAA record is private", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) =>
        String(input).includes("type=AAAA")
          ? dohResponse(["::ffff:169.254.169.254"], "AAAA")
          : dohResponse(["104.18.32.7"], "A"),
      ),
    );
    const r = await validateOutboundUrl("https://mixed.example.com/hook");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("resolves_to_private_address");
  });

  it("[INVARIANT] fails closed when the resolver is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const r = await validateOutboundUrl("https://bridge.example.com/hook");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("validation_unavailable");
      expect(r.unavailable).toBe(true);
    }
  });

  it("[INVARIANT] rejects a hostname with no records", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => dohResponse([], "A")),
    );
    const r = await validateOutboundUrl("https://nowhere.example.com/hook");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("resolution_failed");
  });
});
