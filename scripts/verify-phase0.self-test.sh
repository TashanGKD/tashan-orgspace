#!/usr/bin/env bash
set -eu

repository_root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
fixture_root="$(mktemp -d)"
cleanup() {
  rm -rf -- "$fixture_root"
}
trap cleanup EXIT HUP INT TERM

mkdir -p "$fixture_root/repo"
tar --exclude=.git --exclude=node_modules --exclude=coverage --exclude=.local-data -cf - -C "$repository_root" . \
  | tar -C "$fixture_root/repo" -xf -

ln -s "$repository_root/node_modules" "$fixture_root/repo/node_modules"
while IFS= read -r modules; do
  relative="${modules#"$repository_root"/}"
  mkdir -p "$(dirname -- "$fixture_root/repo/$relative")"
  ln -s "$modules" "$fixture_root/repo/$relative"
done < <(find "$repository_root/apps" "$repository_root/packages" -mindepth 2 -maxdepth 2 -type d -name node_modules -print)

node -e '
  const fs = require("node:fs");
  const path = process.argv[1];
  const bindings = JSON.parse(fs.readFileSync(path, "utf8"));
  delete bindings["device.revoke"];
  fs.writeFileSync(path, `${JSON.stringify(bindings, null, 2)}\n`);
' "$fixture_root/repo/apps/cli/src/capability-bindings.json"

output_file="$fixture_root/verifier-output.txt"
if (cd "$fixture_root/repo" && bash scripts/verify-phase0.sh) >"$output_file" 2>&1; then
  echo "FAIL: verifier accepted missing device.revoke binding" >&2
  exit 1
fi
if ! grep -F "missing CLI binding: device.revoke" "$output_file" >/dev/null; then
  echo "FAIL: verifier failed for the wrong reason" >&2
  sed -n '1,160p' "$output_file" >&2
  exit 1
fi

echo "verify-phase0.self-test: PASS"
