import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

type BrandAsset = {
  name: string;
  publicPath: string;
  source: string;
  sha256: string;
};

const manifestPath = resolve(import.meta.dirname, "brand-assets.json");
const publicRoot = resolve(import.meta.dirname, "../../public");

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("homepage-v2 brand assets", () => {
  test("publishes the reviewed brand-asset manifest", () => {
    expect(existsSync(manifestPath)).toBe(true);
  });

  test("keeps every published asset pinned to its reviewed source", () => {
    const manifestExists = existsSync(manifestPath);
    expect(manifestExists, "brand-assets.json").toBe(true);
    if (!manifestExists) return;

    const assets = JSON.parse(readFileSync(manifestPath, "utf8")) as BrandAsset[];

    expect(assets).toHaveLength(3);
    for (const asset of assets) {
      const assetPath = resolve(publicRoot, asset.publicPath);
      expect(existsSync(assetPath), asset.name).toBe(true);
      expect(sha256(assetPath), asset.name).toBe(asset.sha256);
      expect(asset.source, asset.name).toMatch(/^homepage-v2\/frontend\/public\/media\//);
    }
  });
});
