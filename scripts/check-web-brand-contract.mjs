import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const reviewedImports = [
  '@import "./design-system/brand-tokens.css";',
  '@import "./design-system/global.css";',
  '@import "./design-system/primitives.css";',
  '@import "./design-system/workspace-shell.css";',
  '@import "./design-system/resource-surfaces.css";',
  '@import "./design-system/access.css";',
].join("\n");

const requiredTokens = [
  "--brand-navy: #0e2e4f",
  "--brand-blue: #5b9bd5",
  "--brand-mint: #9fd4c4",
  "--radius-card: 20px",
  "--shadow-card: 0 4px 16px rgba(15, 46, 79, 0.12)",
];

function isInside(root, path) {
  const offset = relative(root, path);
  return offset !== "" && !offset.startsWith(`..${sep}`) && offset !== ".." && !isAbsolute(offset);
}

function listCssFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) files.push(...listCssFiles(path));
    if (entry.isFile() && entry.name.endsWith(".css")) files.push(path);
  }
  return files.sort();
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function checkWebBrandContract(repositoryRoot) {
  const root = resolve(repositoryRoot);
  const webRoot = resolve(root, "apps/web");
  const sourceRoot = resolve(webRoot, "src");
  const publicRoot = resolve(webRoot, "public");
  const manifestPath = resolve(sourceRoot, "design-system/brand-assets.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!Array.isArray(manifest) || manifest.length !== 3) {
    throw new Error("brand asset manifest must contain exactly 3 assets");
  }

  const names = new Set();
  for (const asset of manifest) {
    if (
      typeof asset !== "object" ||
      asset === null ||
      typeof asset.name !== "string" ||
      typeof asset.publicPath !== "string" ||
      typeof asset.source !== "string" ||
      typeof asset.sha256 !== "string"
    ) {
      throw new Error("invalid brand asset manifest entry");
    }
    if (names.has(asset.name)) throw new Error(`duplicate brand asset: ${asset.name}`);
    names.add(asset.name);
    if (!/^media\/brand\/[a-z0-9-]+\.webp$/.test(asset.publicPath)) {
      throw new Error(`brand asset path must stay inside media/brand/: ${asset.publicPath}`);
    }
    if (!/^homepage-v2\/frontend\/public\/media\/[A-Za-z0-9_.-]+$/.test(asset.source)) {
      throw new Error(`invalid brand asset source: ${asset.source}`);
    }
    if (!/^[a-f0-9]{64}$/.test(asset.sha256)) {
      throw new Error(`invalid brand asset checksum: ${asset.name}`);
    }

    const assetPath = resolve(publicRoot, asset.publicPath);
    if (!isInside(publicRoot, assetPath)) {
      throw new Error(`brand asset path escaped public root: ${asset.name}`);
    }
    if (lstatSync(assetPath).isSymbolicLink()) {
      throw new Error(`brand assets must not be symbolic links: ${asset.name}`);
    }
    const realAssetPath = realpathSync(assetPath);
    if (!isInside(realpathSync(publicRoot), realAssetPath)) {
      throw new Error(`brand asset real path escaped public root: ${asset.name}`);
    }
    if (sha256(realAssetPath) !== asset.sha256) {
      throw new Error(`brand asset checksum mismatch: ${asset.name}`);
    }
  }

  const stylesPath = resolve(sourceRoot, "styles.css");
  const styles = readFileSync(stylesPath, "utf8").trim();
  if (styles !== reviewedImports) {
    throw new Error("styles.css must contain only the reviewed imports");
  }

  const cssFiles = listCssFiles(sourceRoot);
  for (const path of cssFiles) {
    const css = readFileSync(path, "utf8");
    const legacyToken = css.match(/--(?:ink|paper(?:-deep)?|red(?:-dark)?|org-[a-z0-9-]+)\b/i);
    if (legacyToken) {
      throw new Error(`legacy visual token in ${relative(root, path)}: ${legacyToken[0]}`);
    }
    if (/url\(\s*["']?https?:\/\//i.test(css)) {
      throw new Error(`remote CSS asset in ${relative(root, path)}`);
    }
    if (
      /font-family\s*:[^;]*(?:Noto Serif|Songti|STSong|Georgia)/i.test(css) ||
      /font-family\s*:[^;]*(?<!-)\bserif\b/i.test(css)
    ) {
      throw new Error(`global serif family in ${relative(root, path)}`);
    }
  }

  const tokenCss = readFileSync(resolve(sourceRoot, "design-system/brand-tokens.css"), "utf8");
  for (const token of requiredTokens) {
    if (!tokenCss.includes(token)) throw new Error(`missing reviewed visual token: ${token}`);
  }

  return { assets: manifest.length, stylesheets: cssFiles.length, violations: 0 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = checkWebBrandContract(repositoryRoot);
  console.log(
    `check-web-brand-contract: PASS (${result.violations} violations, ${result.assets} assets, ${result.stylesheets} stylesheets)`,
  );
}
