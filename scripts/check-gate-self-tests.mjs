import { readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

function isGateFile(name) {
  return (
    (/^check-.*\.mjs$/.test(name) && !name.endsWith(".self-test.mjs")) ||
    (/^verify-.*\.sh$/.test(name) && !name.endsWith(".self-test.sh"))
  );
}

function selfTestFor(gate) {
  if (gate.endsWith(".mjs")) return gate.replace(/\.mjs$/, ".self-test.mjs");
  if (gate.endsWith(".sh")) return gate.replace(/\.sh$/, ".self-test.sh");
  throw new Error(`unsupported gate extension: ${gate}`);
}

function discoverGateFiles(root, current = root) {
  const gates = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) {
      if (isGateFile(entry.name)) {
        throw new Error(`gate files must not be symlinks: ${relative(root, path)}`);
      }
      continue;
    }
    if (entry.isDirectory()) {
      gates.push(...discoverGateFiles(root, path));
      continue;
    }
    if (entry.isFile() && isGateFile(entry.name)) {
      gates.push(path);
    }
  }
  return gates;
}

export function checkGateSelfTests(scriptsRoot) {
  const root = resolve(scriptsRoot);
  const fileSet = new Set(
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => resolve(entry.parentPath, entry.name)),
  );
  const gates = discoverGateFiles(root);
  if (gates.length === 0) throw new Error("no gate scripts discovered");

  for (const gate of gates) {
    const selfTest = selfTestFor(gate);
    if (!fileSet.has(selfTest)) {
      throw new Error(`missing gate self-test: ${relative(root, selfTest).split(sep).join("/")}`);
    }
  }

  return { gates: gates.length, violations: 0 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const scriptsRoot = dirname(fileURLToPath(import.meta.url));
  const result = checkGateSelfTests(scriptsRoot);
  console.log(
    `check-gate-self-tests: PASS (${result.violations} violations, ${result.gates} gates)`,
  );
}
