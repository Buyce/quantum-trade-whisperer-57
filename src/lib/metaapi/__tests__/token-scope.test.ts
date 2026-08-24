/**
 * Invariants for provider access-token scope inspection.
 *
 * A token generated for ONE trading account must be recognised as unable to
 * provision new accounts BEFORE a request is sent, and an unreadable token must
 * never be treated as a definitive refusal.
 */
import { afterEach, describe, expect, it } from "vitest";

import { classifyMetaApiFailure, MetaApiHttpError, MetaApiTokenScopeError } from "../errors";
import {
  decodeAccessRules,
  describeCreateAccountScope,
  inspectCreateAccountScope,
} from "../token-scope";

function tokenWith(accessRules: unknown): string {
  const b64 = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "RS512" })}.${b64({ accessRules })}.signature`;
}

const ACCOUNT_ID = "f6a72106-7709-4835-8022-75cad470a505";

describe("decodeAccessRules", () => {
  it("[UNIT] returns null for anything that is not a readable JWT with rules", () => {
    expect(decodeAccessRules("not-a-token")).toBeNull();
    expect(decodeAccessRules("a.b.c")).toBeNull();
    expect(decodeAccessRules(tokenWith(undefined))).toBeNull();
  });

  it("[UNIT] keeps only well-formed rules", () => {
    const rules = decodeAccessRules(
      tokenWith([
        { id: "metaapi-rest-api", methods: ["m"], roles: ["reader"], resources: [] },
        7,
        {},
      ]),
    );
    expect(rules).toEqual([
      { id: "metaapi-rest-api", methods: ["m"], roles: ["reader"], resources: [] },
    ]);
  });
});

describe("inspectCreateAccountScope", () => {
  it("[INVARIANT] refuses a token pinned to one trading account", () => {
    const token = tokenWith([
      {
        id: "trading-account-management-api",
        methods: ["trading-account-management-api:rest:public:*:*"],
        roles: ["reader", "writer"],
        resources: [`*:$USER_ID$:${ACCOUNT_ID}`],
      },
    ]);
    expect(inspectCreateAccountScope(token)).toEqual({
      allowed: false,
      reason: "account_restricted",
    });
    expect(describeCreateAccountScope("account_restricted")).toMatch(/restricted to specific/i);
  });

  it("[UNIT] allows an unrestricted read-write account-management rule", () => {
    for (const resources of [[], ["*"], ["*:$USER_ID$:*"]]) {
      const token = tokenWith([
        {
          id: "trading-account-management-api",
          methods: [],
          roles: ["reader", "writer"],
          resources,
        },
      ]);
      expect(inspectCreateAccountScope(token)).toEqual({ allowed: true });
    }
  });

  it("[INVARIANT] refuses a writer-only token that could create but not read the new account", () => {
    const token = tokenWith([
      {
        id: "trading-account-management-api",
        methods: [],
        roles: ["writer"],
        resources: [],
      },
    ]);
    expect(inspectCreateAccountScope(token)).toEqual({
      allowed: false,
      reason: "missing_reader",
    });
    expect(describeCreateAccountScope("missing_reader")).toMatch(/reader and writer/i);
  });

  it("[INVARIANT] evaluates all matching rules instead of rejecting on the first restricted one", () => {
    const token = tokenWith([
      {
        id: "trading-account-management-api",
        methods: [],
        roles: ["reader", "writer"],
        resources: [`*:$USER_ID$:${ACCOUNT_ID}`],
      },
      {
        id: "trading-account-management-api",
        methods: [],
        roles: ["reader", "writer"],
        resources: ["*:$USER_ID$:*"],
      },
    ]);
    expect(inspectCreateAccountScope(token)).toEqual({ allowed: true });
  });

  it("[UNIT] refuses a read-only or absent account-management rule", () => {
    expect(
      inspectCreateAccountScope(
        tokenWith([
          { id: "trading-account-management-api", methods: [], roles: ["reader"], resources: [] },
        ]),
      ),
    ).toEqual({ allowed: false, reason: "read_only" });
    expect(
      inspectCreateAccountScope(
        tokenWith([{ id: "metaapi-rest-api", methods: [], roles: ["writer"], resources: [] }]),
      ),
    ).toEqual({ allowed: false, reason: "missing_rule" });
  });

  it("[INVARIANT] reports an unreadable token distinctly, so callers do not fail closed on a parse gap", () => {
    expect(inspectCreateAccountScope("opaque-key")).toEqual({
      allowed: false,
      reason: "unreadable",
    });
  });
});

describe("classification", () => {
  it("[INVARIANT] maps a pre-flight scope refusal to permission and never to retryable", () => {
    const failure = classifyMetaApiFailure(
      new MetaApiTokenScopeError(
        "create account",
        describeCreateAccountScope("account_restricted"),
      ),
    );
    expect(failure.kind).toBe("permission");
    expect(failure.retryable).toBe(false);
    expect(failure.message).toMatch(/nothing was created or charged/i);
  });

  it("[INVARIANT] explains a provider 403 that names createAccount as a token that cannot provision", () => {
    const failure = classifyMetaApiFailure(
      new MetaApiHttpError(
        403,
        "create account",
        JSON.stringify({
          error: "ForbiddenError",
          message:
            "You do not have access to trading-account-management-api:rest:public:account-management:createAccount method",
          methodId: "createAccount",
        }),
      ),
    );
    expect(failure.kind).toBe("permission");
    expect(failure.message).toMatch(
      /cannot provision a new one|not allowed to create trading accounts/i,
    );
    expect(failure.message).toMatch(/link an account you already have/i);
  });
});

describe("token selection", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("[INVARIANT] account management uses the unrestricted token while trading keeps the general one", async () => {
    const { readMetaApiToken, readMetaApiTokens } = await import("../config.server");
    process.env["METAAPI_TOKEN"] = "general";
    process.env["METAAPI_PROVISIONING_TOKEN"] = "unrestricted";
    expect(readMetaApiToken("provisioning")).toBe("unrestricted");
    expect(readMetaApiToken()).toBe("general");
    expect(readMetaApiTokens("provisioning")).toEqual(["unrestricted", "general"]);
    expect(readMetaApiTokens()).toEqual(["general", "unrestricted"]);
  });

  it("[UNIT] falls back to the general token when no provisioning token is configured", async () => {
    const { readMetaApiToken } = await import("../config.server");
    process.env["METAAPI_TOKEN"] = "general";
    delete process.env["METAAPI_PROVISIONING_TOKEN"];
    expect(readMetaApiToken("provisioning")).toBe("general");
  });

  it("[INVARIANT] removes duplicate token candidates instead of sending twice", async () => {
    const { readMetaApiTokens } = await import("../config.server");
    process.env["METAAPI_TOKEN"] = "same";
    process.env["METAAPI_PROVISIONING_TOKEN"] = "same";
    expect(readMetaApiTokens("provisioning")).toEqual(["same"]);
  });
});
