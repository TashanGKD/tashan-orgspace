import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const prohibitedPhrases = [
  "资源视图",
  "产品边界",
  "Phase 0",
  "执行任何服务器操作",
  "真实人员，唯一身份",
  "组织边界，默认私密",
  "以你的真实身份",
  "全部会话将立即失效",
  "DEVICE REVOCATION",
  "02 / DEVICES",
  "01 / ORGANIZATION",
  "正在恢复安全会话",
];

function requireRecord(label, value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

export function checkUserFacingCopy({ capabilities, auditLabels, sources }) {
  if (!Array.isArray(capabilities)) throw new Error("capabilities must be an array");
  if (!Array.isArray(sources)) throw new Error("sources must be an array");
  const labels = requireRecord("audit labels", auditLabels);
  const capabilityIds = capabilities.map((capability) => {
    const value = requireRecord("capability", capability);
    if (typeof value.id !== "string" || value.id === "") throw new Error("invalid capability ID");
    return value.id;
  });
  if (new Set(capabilityIds).size !== capabilityIds.length) {
    throw new Error("duplicate capability ID");
  }

  const labelIds = Object.keys(labels);
  for (const capabilityId of capabilityIds) {
    if (!Object.hasOwn(labels, capabilityId))
      throw new Error(`missing audit label: ${capabilityId}`);
    const label = labels[capabilityId];
    if (typeof label !== "string" || label.trim() === "" || label === capabilityId) {
      throw new Error(`audit label must be human-readable: ${capabilityId}`);
    }
    if (label !== label.trim()) {
      throw new Error(`audit label must not contain surrounding whitespace: ${capabilityId}`);
    }
    if (/^\p{ASCII}+$/u.test(label)) {
      throw new Error(`audit label must contain user-facing language: ${capabilityId}`);
    }
  }
  for (const labelId of labelIds) {
    if (!capabilityIds.includes(labelId)) throw new Error(`unknown audit label: ${labelId}`);
  }
  if (sorted(capabilityIds).join("\n") !== sorted(labelIds).join("\n")) {
    throw new Error("audit label registry differs from capability registry");
  }

  for (const rawSource of sources) {
    const source = requireRecord("user-facing source", rawSource);
    if (typeof source.path !== "string" || typeof source.text !== "string") {
      throw new Error("invalid user-facing source");
    }
    for (const phrase of prohibitedPhrases) {
      if (source.text.includes(phrase)) {
        throw new Error(`prohibited user-facing phrase: ${phrase} (${source.path})`);
      }
    }
  }

  return { capabilities: capabilityIds.length, violations: 0 };
}

function discoverSources(root, current = root) {
  const sources = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`user-facing source must not be a symlink: ${relative(root, path)}`);
    }
    if (entry.isDirectory()) {
      sources.push(...discoverSources(root, path));
      continue;
    }
    if (
      entry.isFile() &&
      !entry.name.includes(".test.") &&
      /\.(?:tsx?|json|css|html)$/.test(entry.name)
    ) {
      sources.push({
        path: relative(root, path).split(sep).join("/"),
        text: readFileSync(path, "utf8"),
      });
    }
  }
  return sources;
}

export function checkRepositoryUserFacingCopy(repositoryRoot) {
  const webSourceRoot = resolve(repositoryRoot, "apps/web/src");
  return checkUserFacingCopy({
    capabilities: JSON.parse(
      readFileSync(
        resolve(repositoryRoot, "packages/capabilities/src/phase0-capabilities.json"),
        "utf8",
      ),
    ),
    auditLabels: JSON.parse(
      readFileSync(resolve(webSourceRoot, "content/audit-action-labels.json"), "utf8"),
    ),
    sources: [
      ...discoverSources(webSourceRoot),
      {
        path: "index.html",
        text: readFileSync(resolve(repositoryRoot, "apps/web/index.html"), "utf8"),
      },
    ],
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = checkRepositoryUserFacingCopy(repositoryRoot);
  console.log(
    `check-user-facing-copy: PASS (${result.violations} violations, ${result.capabilities} capabilities)`,
  );
}
