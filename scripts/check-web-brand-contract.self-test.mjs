import { strict as assert } from "node:assert";
import {
  copyFileSync,
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkWebBrandContract } from "./check-web-brand-contract.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const imports = [
  '@import "./design-system/brand-tokens.css";',
  '@import "./design-system/global.css";',
  '@import "./design-system/primitives.css";',
  '@import "./design-system/workspace-shell.css";',
  '@import "./design-system/resource-surfaces.css";',
  '@import "./design-system/access.css";',
].join("\n");

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "orgspace-brand-gate-"));
  const sourceRoot = resolve(root, "apps/web/src");
  const designSystem = resolve(sourceRoot, "design-system");
  const publicBrand = resolve(root, "apps/web/public/media/brand");
  mkdirSync(designSystem, { recursive: true });
  mkdirSync(publicBrand, { recursive: true });
  cpSync(resolve(repositoryRoot, "apps/web/public/media/brand"), publicBrand, {
    recursive: true,
  });
  copyFileSync(
    resolve(repositoryRoot, "apps/web/src/design-system/brand-assets.json"),
    resolve(designSystem, "brand-assets.json"),
  );
  for (const file of [
    "brand-tokens.css",
    "global.css",
    "primitives.css",
    "workspace-shell.css",
    "resource-surfaces.css",
    "access.css",
  ]) {
    writeFileSync(
      resolve(designSystem, file),
      file === "brand-tokens.css"
        ? ":root { --brand-navy: #0e2e4f; --brand-blue: #5b9bd5; --brand-mint: #9fd4c4; --radius-card: 20px; --shadow-card: 0 4px 16px rgba(15, 46, 79, 0.12); }\n"
        : ":root { --fixture: 1; }\n",
    );
  }
  writeFileSync(resolve(sourceRoot, "styles.css"), `${imports}\n`);
  return root;
}

function rejectMutation(mutate, expected) {
  const root = makeFixture();
  try {
    mutate(root);
    assert.throws(() => checkWebBrandContract(root), expected);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

const cleanRoot = makeFixture();
try {
  assert.deepEqual(checkWebBrandContract(cleanRoot), { assets: 3, stylesheets: 7, violations: 0 });
} finally {
  rmSync(cleanRoot, { force: true, recursive: true });
}

rejectMutation((root) => {
  const manifestPath = resolve(root, "apps/web/src/design-system/brand-assets.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest[0].sha256 = "0".repeat(64);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}, /brand asset checksum mismatch: mountain-background/);

rejectMutation((root) => {
  const path = resolve(root, "apps/web/src/styles.css");
  writeFileSync(path, `${imports.replace('@import "./design-system/access.css";', "")}\n`);
}, /styles.css must contain only the reviewed imports/);

rejectMutation((root) => {
  const path = resolve(root, "apps/web/src/design-system/global.css");
  writeFileSync(path, ":root { --ink: #000; }\n");
}, /legacy visual token.*--ink/);

rejectMutation((root) => {
  const path = resolve(root, "apps/web/src/design-system/access.css");
  writeFileSync(path, '.access { background: url("https://preview2.tashan.ac.cn/bg.webp"); }\n');
}, /remote CSS asset/);

rejectMutation((root) => {
  const manifestPath = resolve(root, "apps/web/src/design-system/brand-assets.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest[0].publicPath = "../../../../etc/passwd";
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}, /brand asset path must stay inside media\/brand/);

rejectMutation((root) => {
  const manifestPath = resolve(root, "apps/web/src/design-system/brand-assets.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest[0].publicPath = "/etc/passwd";
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}, /brand asset path must stay inside media\/brand/);

rejectMutation((root) => {
  const assetPath = resolve(root, "apps/web/public/media/brand/bg-horizontal.webp");
  const outside = resolve(root, "outside.webp");
  copyFileSync(assetPath, outside);
  rmSync(assetPath);
  symlinkSync(outside, assetPath);
}, /brand assets must not be symbolic links/);

console.log("check-web-brand-contract.self-test: PASS");
