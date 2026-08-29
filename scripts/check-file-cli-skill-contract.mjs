import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function requireUnique(label, values) {
  const repeated = values.filter((value, index) => values.indexOf(value) !== index);
  if (repeated.length > 0)
    throw new Error(`duplicate ${label}: ${[...new Set(repeated)].join(", ")}`);
}

export function checkFileCliSkillContract(input) {
  requireUnique("file contract capability", input.contractIds);
  const serverById = new Map(input.server.map((capability) => [capability.id, capability]));
  const skillSet = new Set(input.skillCapabilities);
  for (const id of input.contractIds) {
    const capability = serverById.get(id);
    if (capability === undefined) throw new Error(`missing server file capability: ${id}`);
    const binding = input.bindings[id];
    if (typeof binding !== "string" || binding.trim() === "") {
      throw new Error(`missing file CLI binding: ${id}`);
    }
    if (capability.cli !== binding) throw new Error(`file CLI binding drift: ${id}`);
    if (!skillSet.has(id)) throw new Error(`missing file Skill capability: ${id}`);
    if (!input.fileReference.includes(`torg ${binding}`)) {
      throw new Error(`file Skill reference is missing command: torg ${binding}`);
    }
  }
  if (!/references\/files\.md/.test(input.skillMain)) {
    throw new Error("Skill must route file work to references/files.md");
  }
  if (!/never call (?:minio or s3|s3 or minio) directly/i.test(input.fileReference)) {
    throw new Error("file Skill must forbid direct MinIO or S3 calls");
  }
  if (!/never (?:print or reuse|reuse or print) presigned urls/i.test(input.fileReference)) {
    throw new Error("file Skill must forbid printing or reusing presigned URLs");
  }
  return { capabilities: input.contractIds.length, violations: 0 };
}

function contractIds(source) {
  const block = /export const FileCapabilityId = z\.enum\(\[([\s\S]*?)\]\);/.exec(source)?.[1];
  if (block === undefined) throw new Error("FileCapabilityId contract enum was not found");
  return [...block.matchAll(/"([a-z]+(?:\.[a-z]+)+)"/g)].map((match) => match[1]);
}

export function checkRepositoryFileCliSkillContract(repositoryRoot) {
  const read = (path) => readFileSync(resolve(repositoryRoot, path), "utf8");
  const skillDocument = JSON.parse(read("skill/tashan-orgspace/capability-references.json"));
  return checkFileCliSkillContract({
    contractIds: contractIds(read("packages/contracts/src/files.ts")),
    server: JSON.parse(read("packages/capabilities/src/phase0-capabilities.json")),
    bindings: JSON.parse(read("apps/cli/src/capability-bindings.json")),
    skillCapabilities: skillDocument.capabilities,
    skillMain: read("skill/tashan-orgspace/SKILL.md"),
    fileReference: read("skill/tashan-orgspace/references/files.md"),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = checkRepositoryFileCliSkillContract(root);
  console.log(
    `check-file-cli-skill-contract: PASS (${result.violations} violations, ${result.capabilities} capabilities)`,
  );
}
