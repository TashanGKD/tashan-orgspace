import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";
import { parse } from "yaml";

import { assertLocalServiceUrl, assertSafeLocalComposeModel } from "./infra.js";

describe("local infrastructure URL invariant", () => {
  test.each([
    "postgres://user:pass@db.example.com:5432/orgspace",
    "redis://10.0.0.4:6379",
    "redis://127.0.0.1.evil.example:6379",
    "redis://127.0.0.1@db.example.com:6379",
    "redis://[::ffff:127.0.0.1]:6379",
  ])("rejects a non-loopback local-test URL: %s", (url) => {
    expect(() => assertLocalServiceUrl(url)).toThrow(/loopback/);
  });

  test.each([
    "postgres://orgspace:orgspace@127.0.0.1:55432/orgspace",
    "redis://localhost:56379",
    "redis://[::1]:56379",
  ])("accepts an explicit loopback URL: %s", (url) => {
    expect(() => assertLocalServiceUrl(url)).not.toThrow();
  });
});

describe("Compose safety invariant", () => {
  const safeModel = {
    services: {
      postgres: {
        environment: {
          POSTGRES_PASSWORD: "${ORGSPACE_LOCAL_POSTGRES_PASSWORD:?set it}",
        },
        ports: ["127.0.0.1:55432:5432"],
      },
      redis: { ports: ["127.0.0.1:56379:6379"] },
    },
    volumes: { "postgres-data": {}, "redis-data": {} },
  };

  test.each([
    [
      "bare host port",
      { ...safeModel, services: { ...safeModel.services, postgres: { ports: ["55432:5432"] } } },
    ],
    [
      "wildcard bind",
      {
        ...safeModel,
        services: { ...safeModel.services, redis: { ports: ["0.0.0.0:56379:6379"] } },
      },
    ],
    [
      "automatic restart",
      {
        ...safeModel,
        services: {
          ...safeModel.services,
          postgres: { ...safeModel.services.postgres, restart: "always" },
        },
      },
    ],
  ])("rejects %s", (_name, model) => {
    expect(() => assertSafeLocalComposeModel(model)).toThrow(/local Compose safety/);
  });

  test.each([
    ["hardcoded credential", "known-password"],
    ["default credential", "${ORGSPACE_LOCAL_POSTGRES_PASSWORD:-known-password}"],
    ["empty credential", ""],
  ])("rejects a %s", (_name, password) => {
    const model = {
      ...safeModel,
      services: {
        ...safeModel.services,
        postgres: {
          ...safeModel.services.postgres,
          environment: { POSTGRES_PASSWORD: password },
        },
      },
    };

    expect(() => assertSafeLocalComposeModel(model)).toThrow(/local Compose safety/);
  });

  test("accepts the checked-in local Compose model", () => {
    const composeUrl = new URL("../../../deploy/compose.local.yml", import.meta.url);
    const model: unknown = parse(readFileSync(composeUrl, "utf8"));

    expect(() => assertSafeLocalComposeModel(model)).not.toThrow();
  });
});
