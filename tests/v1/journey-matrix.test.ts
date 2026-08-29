import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import matrix from "./journey-matrix.json" with { type: "json" };

const root = resolve(import.meta.dirname, "../..");
describe("v1 complete user journey matrix", () => {
  test("binds every area to an executable E2E and Web acceptance file", () => {
    expect(matrix).toHaveLength(11);
    const areas = new Set<string>();
    const scenarioSource = readFileSync(resolve(root, "tests/e2e/support/cli-scenario.ts"), "utf8");
    for (const entry of matrix) {
      expect(areas.has(entry.area), `duplicate area ${entry.area}`).toBe(false);
      areas.add(entry.area);
      expect(existsSync(resolve(root, entry.e2e)), entry.e2e).toBe(true);
      expect(readFileSync(resolve(root, entry.e2e), "utf8")).toContain("test(");
      if (entry.scenario) expect(scenarioSource).toContain(`input.type === "${entry.scenario}"`);
      expect(entry.web.length).toBeGreaterThan(0);
      for (const path of entry.web) expect(existsSync(resolve(root, path)), path).toBe(true);
    }
  });
});
