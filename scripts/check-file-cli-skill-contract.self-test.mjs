import { strict as assert } from "node:assert";

import { checkFileCliSkillContract } from "./check-file-cli-skill-contract.mjs";

const ids = ["file.upload.create", "file.download.create", "file.delete"];
const server = ids.map((id) => ({
  id,
  cli:
    id === "file.upload.create"
      ? "file upload"
      : id === "file.download.create"
        ? "file download"
        : "file delete",
}));
const bindings = Object.fromEntries(server.map(({ id, cli }) => [id, cli]));
const valid = {
  contractIds: ids,
  server,
  bindings,
  skillCapabilities: ids,
  skillMain: "Read references/files.md before file work.",
  fileReference:
    "Use torg file upload, torg file download, and torg file delete. Never call MinIO or S3 directly. Never print or reuse presigned URLs.",
};

assert.throws(
  () =>
    checkFileCliSkillContract({
      ...valid,
      bindings: { ...bindings, "file.upload.create": undefined },
    }),
  /missing file CLI binding: file.upload.create/,
);
assert.throws(
  () => checkFileCliSkillContract({ ...valid, skillCapabilities: ids.slice(1) }),
  /missing file Skill capability: file.upload.create/,
);
assert.throws(
  () =>
    checkFileCliSkillContract({
      ...valid,
      bindings: { ...bindings, "file.upload.create": "upload raw" },
    }),
  /file CLI binding drift: file.upload.create/,
);
assert.throws(
  () =>
    checkFileCliSkillContract({
      ...valid,
      fileReference:
        "Use torg file upload, torg file download, and torg file delete. Call MinIO directly with the signed URL. Never print or reuse presigned URLs.",
    }),
  /must forbid direct MinIO or S3 calls/,
);
assert.throws(
  () => checkFileCliSkillContract({ ...valid, skillMain: "No file reference is needed." }),
  /must route file work to references\/files.md/,
);
assert.doesNotThrow(() => checkFileCliSkillContract(valid));

console.log("check-file-cli-skill-contract.self-test: PASS");
