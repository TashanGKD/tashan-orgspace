import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function majorVersion(name, value) {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value)) {
    throw new Error(`${name} must be a valid ${name} version`);
  }

  return Number.parseInt(value.split(".", 1)[0], 10);
}

export function checkVersions({ node, pnpm }) {
  if (majorVersion("Node", node) !== 24) {
    throw new Error("Node 24 is required");
  }
  if (majorVersion("pnpm", pnpm) !== 10) {
    throw new Error("pnpm 10 is required");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  checkVersions({
    node: process.versions.node,
    pnpm: execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim(),
  });
  console.log("check-toolchain: PASS");
}
