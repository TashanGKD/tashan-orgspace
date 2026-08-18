import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const COVERAGE_CLAIM = /\b(?:all green|0 violations|fully covered)\b/i;
const CITATION = /(?:^|\s)((?:\.{0,2}\/|\/)?[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*):([1-9]\d*)\b/g;

function escapesRoot(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(pathFromRoot)
  );
}

export function checkCommitEvidence(message, repositoryRoot) {
  const citations = [...message.matchAll(CITATION)].map((match) => ({
    path: match[1],
    line: Number.parseInt(match[2], 10),
  }));

  if (COVERAGE_CLAIM.test(message) && citations.length === 0) {
    throw new Error("coverage claims require at least one file:line citation");
  }

  const root = realpathSync(resolve(repositoryRoot));
  for (const citation of citations) {
    const candidate = resolve(root, citation.path);
    if (escapesRoot(root, candidate) || !existsSync(candidate)) {
      throw new Error(`citation path escapes repository root or does not exist: ${citation.path}`);
    }
    const realCandidate = realpathSync(candidate);
    if (escapesRoot(root, realCandidate)) {
      throw new Error(`citation path escapes repository root: ${citation.path}`);
    }
    if (!statSync(realCandidate).isFile()) {
      throw new Error(`citation path is not a file: ${citation.path}`);
    }

    const lines = readFileSync(realCandidate, "utf8").split(/\r\n|\r|\n/);
    if (citation.line > lines.length) {
      throw new Error(`citation line is out of range: ${citation.path}:${citation.line}`);
    }
    if (lines[citation.line - 1]?.trim() === "") {
      throw new Error(`cited line is blank or not evidence: ${citation.path}:${citation.line}`);
    }
  }

  return { citations: citations.length, violations: 0 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const messagePath = process.argv[2];
  if (messagePath === undefined) {
    console.error("usage: node scripts/check-commit-evidence.mjs <commit-message-file>");
    process.exitCode = 2;
  } else {
    const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const result = checkCommitEvidence(readFileSync(messagePath, "utf8"), repositoryRoot);
    console.log(
      `check-commit-evidence: PASS (${result.violations} violations, ${result.citations} citations)`,
    );
  }
}
