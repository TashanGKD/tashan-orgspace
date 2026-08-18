import { describe, expect, test } from "vitest";

import { hashIdempotencyInput } from "./idempotency-repository.js";

describe("canonical idempotency hashing", () => {
  test("ignores plain-object key order but preserves array order", () => {
    expect(hashIdempotencyInput({ b: 2, a: 1 })).toBe(hashIdempotencyInput({ a: 1, b: 2 }));
    expect(hashIdempotencyInput([1, 2])).not.toBe(hashIdempotencyInput([2, 1]));
  });

  test.each([
    ["undefined", { value: undefined }],
    ["non-finite number", { value: Number.POSITIVE_INFINITY }],
    ["class instance", new Date()],
  ])("rejects non-JSON input containing %s", (_name, value) => {
    expect(() => hashIdempotencyInput(value)).toThrow(/idempotency input/);
  });

  test("rejects cyclic input", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => hashIdempotencyInput(cyclic)).toThrow(/cycle/);
  });
});
