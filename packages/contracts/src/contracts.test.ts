import { describe, expect, test } from "vitest";

import {
  ActorSource,
  ErrorEnvelope,
  LoginRequest,
  OrganizationMemberAddRequest,
  OrganizationRole,
  PhoneNumber,
  Phase0CreatablePrincipalType,
  PrincipalType,
  RefreshRequest,
  RegisterRequest,
} from "./index.js";

describe("security discriminants", () => {
  test.each(["root", "owner", "ai_employee", "service_account"])(
    'rejects Phase 0 principal creation type "%s"',
    (value) => {
      expect(Phase0CreatablePrincipalType.safeParse(value).success).toBe(false);
    },
  );

  test.each(["admin", "superadmin", "guest"])("rejects role alias %s", (value) => {
    expect(OrganizationRole.safeParse(value).success).toBe(false);
  });

  test("reserves future Principal types without making them Phase 0 creatable", () => {
    expect(PrincipalType.parse("ai_employee")).toBe("ai_employee");
    expect(PrincipalType.parse("service_account")).toBe("service_account");
  });

  test("accepts only the two Phase 0 creatable Principal types", () => {
    expect(Phase0CreatablePrincipalType.parse("human")).toBe("human");
    expect(Phase0CreatablePrincipalType.parse("system")).toBe("system");
  });

  test.each(["platform_superadmin", "platform_operator", "org_owner", "org_admin", "member"])(
    "accepts exact role %s",
    (role) => {
      expect(OrganizationRole.parse(role)).toBe(role);
    },
  );

  test("rejects client-invented actor source", () => {
    expect(ActorSource.safeParse("trusted_cli").success).toBe(false);
  });
});

describe("identity inputs", () => {
  test.each(["13800138000", "+0123456789", "+86138 0013 8000", "+1234567", "+1234567890123456"])(
    "rejects non-E.164 phone value %s",
    (value) => {
      expect(PhoneNumber.safeParse(value).success).toBe(false);
    },
  );

  test("accepts an E.164 phone", () => {
    expect(PhoneNumber.parse("+8613800138000")).toBe("+8613800138000");
  });

  test("rejects actor-source injection in login", () => {
    const validLogin = {
      username: "alice",
      password: "CorrectHorseBattery9",
      device: {
        id: "8df6fa80-6de8-48dd-92cb-a14db311c8e8",
        name: "Alice Mac",
        os: "darwin",
        architecture: "arm64",
        clientVersion: "0.1.0",
        channel: "cli",
      },
    };

    expect(LoginRequest.safeParse(validLogin).success).toBe(true);

    const result = LoginRequest.safeParse({
      ...validLogin,
      actorSource: "system",
    });

    expect(result.success).toBe(false);
  });

  test("rejects weak registration passwords", () => {
    expect(RegisterRequest.safeParse({ username: "alice", password: "password" }).success).toBe(
      false,
    );
  });

  test("allows an empty refresh body for an HttpOnly Web cookie", () => {
    expect(RefreshRequest.parse({})).toEqual({});
  });
});

describe("organization and error boundaries", () => {
  test.each(["platform_superadmin", "platform_operator"])(
    "rejects platform role assignment through organization membership: %s",
    (role) => {
      expect(
        OrganizationMemberAddRequest.safeParse({
          accountId: "ebda862a-e78f-41ca-9c84-1484762a1ee7",
          role,
        }).success,
      ).toBe(false);
    },
  );

  test("requires a UUID request ID in the error envelope", () => {
    const validEnvelope = {
      error: {
        code: "AUTH_REQUIRED",
        message: "authentication required",
        requestId: "7f24ea08-8e7d-4d11-a51e-a3816f3d93fa",
      },
    } as const;

    expect(ErrorEnvelope.safeParse(validEnvelope).success).toBe(true);
    expect(
      ErrorEnvelope.safeParse({
        ...validEnvelope,
        error: { ...validEnvelope.error, requestId: "client-chosen-id" },
      }).success,
    ).toBe(false);
  });
});
