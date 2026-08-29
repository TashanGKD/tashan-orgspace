import { describe, expect, test } from "vitest";
import { BlindIndex } from "./blind-index.js";

describe("blind index", () => {
  test("normalizes exact phone, email and WeChat values deterministically", () => {
    const index = new BlindIndex(Buffer.alloc(32, 7));
    expect(index.phone("138 1234 5678")).toBe(index.phone("+86-138-1234-5678"));
    expect(index.email(" User@Example.COM ")).toBe(index.email("user@example.com"));
    expect(index.wechat(" WeChat_ID ")).toBe(index.wechat("wechat_id"));
    expect(index.phone("13812345678")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  test("separates field namespaces", () => {
    const index = new BlindIndex(Buffer.alloc(32, 7));
    expect(index.email("same")).not.toBe(index.wechat("same"));
  });
});
