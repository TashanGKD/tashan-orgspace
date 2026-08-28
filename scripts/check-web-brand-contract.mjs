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

const reviewedAssets = new Map([
  [
    "mountain-background",
    {
      publicPath: "media/brand/bg-horizontal.webp",
      source: "homepage-v2/frontend/public/media/bg_horizontal.webp",
      sha256: "b155f0f9a65c3262803f58b571c07d675663cd61d405690d7d15366563913c45",
    },
  ],
  [
    "complete-logo",
    {
      publicPath: "media/brand/logo-complete.webp",
      source: "homepage-v2/frontend/public/media/logo_complete.webp",
      sha256: "8dfd1d4cffd2886cd118d74e945075414912c6359e74eb235cf2993c052e60a8",
    },
  ],
  [
    "square-logo",
    {
      publicPath: "media/brand/logo-square.webp",
      source: "homepage-v2/frontend/public/media/logo_square_2.webp",
      sha256: "3d990e6ca08a3f46e0b184fcfab78b5ad7ee077c4285fee12681b3400f5411cc",
    },
  ],
]);

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

function listSourceFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) files.push(...listSourceFiles(path));
    if (entry.isFile() && /\.(?:css|html|json|ts|tsx)$/.test(entry.name)) files.push(path);
  }
  return files.sort();
}

function cssHexVariable(css, name) {
  const match = css.match(new RegExp(`${name}:\\s*(#[a-f0-9]{6})`, "i"));
  if (match?.[1] === undefined) throw new Error(`missing color token for contrast check: ${name}`);
  return match[1];
}

function relativeLuminance(hex) {
  const channels = [1, 3, 5]
    .map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first, second) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
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
    const reviewed = reviewedAssets.get(asset.name);
    if (
      reviewed === undefined ||
      reviewed.publicPath !== asset.publicPath ||
      reviewed.source !== asset.source ||
      reviewed.sha256 !== asset.sha256
    ) {
      throw new Error(`reviewed brand asset metadata mismatch: ${asset.name}`);
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
    const legacyColor = css.match(/#(?:1b1b17|b53527|84251d|f5f1e7|e9e5da|4fa8aa)\b/i);
    if (legacyColor) {
      throw new Error(`legacy visual color in ${relative(root, path)}: ${legacyColor[0]}`);
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

  for (const textToken of ["--text-secondary", "--text-tertiary"]) {
    for (const surfaceToken of ["--surface-primary", "--surface-secondary"]) {
      const ratio = contrastRatio(
        cssHexVariable(tokenCss, textToken),
        cssHexVariable(tokenCss, surfaceToken),
      );
      if (ratio < 4.5) {
        throw new Error(`text contrast below WCAG AA: ${textToken} on ${surfaceToken}`);
      }
    }
  }

  const scannedSourceFiles = [...listSourceFiles(sourceRoot), resolve(webRoot, "index.html")];
  for (const path of scannedSourceFiles) {
    const source = readFileSync(path, "utf8");
    const legacyColor = source.match(/#(?:171714|1b1b17|b53527|84251d|f5f1e7|e9e5da|4fa8aa)\b/i);
    if (legacyColor) {
      throw new Error(`legacy visual color in ${relative(root, path)}: ${legacyColor[0]}`);
    }
    if (/https?:\/\/(?:preview2\.tashan\.ac\.cn|[^\s"']*homepage-v2)/i.test(source)) {
      throw new Error(`remote brand hotlink in ${relative(root, path)}`);
    }
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
