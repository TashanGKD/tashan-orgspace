import { describe, expect, test } from "vitest";

import { LoginResponse } from "@tashan/contracts";

import { createDatabaseClient } from "../../apps/api/src/db/client.js";
import {
  e2eEnvironment,
  e2eJsonRequest,
  loginPhone,
  registerAndVerify,
  sendVerificationChallenge,
} from "./support/flows.js";

describe("phone authentication lifecycle", () => {
  test("password reset revokes every old device and leaves redacted audit evidence", async () => {
    const account = await registerAndVerify("reset-member", "+8613800138104");
    const deviceA = crypto.randomUUID();
    const deviceB = crypto.randomUUID();
    const loginA = LoginResponse.parse(
      (await loginPhone(account.phone, account.password, deviceA, "Reset Mac E2E")).body,
    );
    const loginB = LoginResponse.parse(
      (await loginPhone(account.phone, account.password, deviceB, "Reset Linux E2E")).body,
    );

    for (const login of [loginA, loginB]) {
      const identity = await e2eJsonRequest("/v1/auth/whoami", {
        method: "GET",
        headers: { authorization: `Bearer ${login.tokens.accessToken}` },
      });
      expect(identity.status).toBe(200);
    }

    const nextPassword = "AnotherStrongPassword9";
    const challenge = await sendVerificationChallenge(account.phone, "password_reset");
    const reset = await e2eJsonRequest("/v1/auth/password/reset", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `e2e-reset-${crypto.randomUUID()}`,
        "x-torg-invocation-source": "ai_via_cli",
      },
      body: JSON.stringify({
        phone: account.phone,
        challengeId: challenge.challengeId,
        code: challenge.code,
        newPassword: nextPassword,
      }),
    });
    expect(reset).toMatchObject({ status: 200, body: { reset: true } });

    for (const login of [loginA, loginB]) {
      expect(
        (
          await e2eJsonRequest("/v1/auth/whoami", {
            method: "GET",
            headers: { authorization: `Bearer ${login.tokens.accessToken}` },
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await e2eJsonRequest("/v1/auth/refresh", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ refreshToken: login.tokens.refreshToken }),
          })
        ).status,
      ).toBe(401);
    }

    expect(
      (await loginPhone(account.phone, account.password, crypto.randomUUID(), "Old Password"))
        .status,
    ).toBe(401);
    expect(
      (await loginPhone(account.phone, nextPassword, crypto.randomUUID(), "New Password")).status,
    ).toBe(200);

    const sql = createDatabaseClient(e2eEnvironment().databaseUrl);
    try {
      const rows = await sql<
        {
          server_ip: string;
          device_metadata: unknown;
          actor_source: string;
          reported_actor_source: string | null;
          request_id: string;
          after_state: unknown;
        }[]
      >`
        select server_ip, device_metadata, actor_source, reported_actor_source,
               request_id, after_state
        from audit_events
        where capability_id in ('auth.login', 'auth.password.reset')
        order by created_at
      `;
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            server_ip: "127.0.0.1",
            device_metadata: expect.objectContaining({ name: "Reset Mac E2E" }),
            actor_source: "cli",
            reported_actor_source: "cli",
            request_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
          }),
        ]),
      );
      const serialized = JSON.stringify(rows);
      expect(serialized).toContain("+86138****8104");
      expect(serialized).not.toContain(account.phone);
      expect(serialized).not.toContain(challenge.code);
      expect(serialized).not.toContain(account.password);
      expect(serialized).not.toContain(nextPassword);
      expect(serialized).not.toContain(loginA.tokens.accessToken);
      expect(serialized).not.toContain(loginA.tokens.refreshToken);
    } finally {
      await sql.end();
    }
  });
});
