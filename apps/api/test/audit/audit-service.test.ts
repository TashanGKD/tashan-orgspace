import { describe, expect, test } from "vitest";

import { deriveAuditActorContext } from "../../src/audit/audit-context.js";
import { canonicalJson } from "../../src/audit/audit-service.js";
import { redact } from "../../src/audit/redaction.js";
import { resolveClientIp } from "../../src/http/trusted-proxy.js";

describe("trusted proxy resolution", () => {
  test("ignores x-forwarded-for from an untrusted peer", () => {
    expect(
      resolveClientIp({
        peer: "203.0.113.7",
        forwardedFor: "10.0.0.1",
        trustedProxies: [],
      }),
    ).toEqual({ clientIp: "203.0.113.7", proxyChain: [] });
  });

  test("walks only a fully configured trusted proxy suffix", () => {
    expect(
      resolveClientIp({
        peer: "10.0.0.10",
        forwardedFor: "198.51.100.23, 10.0.0.4",
        trustedProxies: ["10.0.0.0/8"],
      }),
    ).toEqual({
      clientIp: "198.51.100.23",
      proxyChain: ["10.0.0.4", "10.0.0.10"],
    });
  });

  test("fails closed on malformed or oversized forwarding chains", () => {
    const trusted = ["10.0.0.0/8"];
    expect(
      resolveClientIp({ peer: "10.0.0.10", forwardedFor: "not-an-ip", trustedProxies: trusted }),
    ).toEqual({ clientIp: "10.0.0.10", proxyChain: [] });

    expect(
      resolveClientIp({
        peer: "10.0.0.10",
        forwardedFor: Array.from({ length: 21 }, (_, index) => `192.0.2.${index + 1}`).join(","),
        trustedProxies: trusted,
      }),
    ).toEqual({ clientIp: "10.0.0.10", proxyChain: [] });
  });

  test("supports IPv6 trusted proxy ranges and normalizes mapped IPv4 peers", () => {
    expect(
      resolveClientIp({
        peer: "2001:db8::10",
        forwardedFor: "2001:db9::20",
        trustedProxies: ["2001:db8::/32"],
      }),
    ).toEqual({ clientIp: "2001:db9::20", proxyChain: ["2001:db8::10"] });

    expect(
      resolveClientIp({
        peer: "::ffff:203.0.113.7",
        forwardedFor: "10.0.0.1",
        trustedProxies: [],
      }),
    ).toEqual({ clientIp: "203.0.113.7", proxyChain: [] });
  });
});

describe("audit redaction", () => {
  test("redacts phone and refresh token", () => {
    expect(redact({ phone: "+8613800138000", refreshToken: "secret" })).toEqual({
      phone: "+86138****8000",
      refreshToken: "[REDACTED]",
    });
  });

  test("redacts case-insensitive sensitive keys recursively without mutating input", () => {
    const source = {
      profile: { phone_e164: "+14155552671", PASSWORD: "hunter2" },
      headers: [{ authorization: "Bearer secret" }],
      safe: "kept",
    };

    expect(redact(source)).toEqual({
      profile: { phone_e164: "+14155***2671", PASSWORD: "[REDACTED]" },
      headers: [{ authorization: "[REDACTED]" }],
      safe: "kept",
    });
    expect(source.profile.PASSWORD).toBe("hunter2");
  });

  test("rejects cyclic structures instead of recursing indefinitely", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => redact(cyclic)).toThrow("audit payload contains a cycle");
  });
});

describe("canonical audit representation", () => {
  test("sorts object keys recursively while preserving array order", () => {
    expect(canonicalJson({ z: [{ b: 2, a: 1 }], a: true })).toBe('{"a":true,"z":[{"a":1,"b":2}]}');
    expect(canonicalJson({ a: true, z: [{ a: 1, b: 2 }] })).toBe(
      canonicalJson({ z: [{ b: 2, a: 1 }], a: true }),
    );
  });

  test("rejects non-JSON values", () => {
    expect(() => canonicalJson({ value: Number.NaN })).toThrow("finite JSON number");
    expect(() => canonicalJson({ value: undefined })).toThrow("JSON-compatible");
  });
});

describe("audit actor context", () => {
  test("accepts ai_via_cli only as an annotation on a CLI session", () => {
    expect(deriveAuditActorContext("cli", "ai_via_cli")).toEqual({
      actorSource: "ai_via_cli",
      reportedActorSource: "ai_via_cli",
    });
  });

  test("an untrusted annotation never changes a web session authorization source", () => {
    expect(deriveAuditActorContext("web", "ai_via_cli")).toEqual({
      actorSource: "web",
      reportedActorSource: "ai_via_cli",
    });
    expect(deriveAuditActorContext("cli", "system")).toEqual({
      actorSource: "cli",
      reportedActorSource: "system",
    });
  });
});
