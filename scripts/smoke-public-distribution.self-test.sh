#!/usr/bin/env bash
set -euo pipefail

repository_root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
smoke="$repository_root/scripts/smoke-public-distribution.sh"
temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/orgspace-distribution-smoke-test.XXXXXX")"
fixture="$temporary_root/fixture"
fake_bin="$temporary_root/bin"
mkdir -p "$fixture" "$fake_bin"
trap 'rm -rf "$temporary_root"' EXIT INT TERM

version="$(node -p "JSON.parse(require('node:fs').readFileSync('$repository_root/release/cli-release.json')).version")"
mkdir -p "$fixture/v$version"
assets=()
while IFS= read -r asset; do assets+=("$asset"); done < <(node -e '
  const r=JSON.parse(require("node:fs").readFileSync(process.argv[1]));
  console.log(r.skillAsset); for (const p of r.platforms) console.log(p.asset);
' "$repository_root/release/cli-release.json")
printf '%s\n' '#!/bin/sh' 'echo fixture installer' >"$fixture/install-skill.sh"
: >"$fixture/v$version/SHA256SUMS"
for asset in "${assets[@]}"; do
  printf '%s\n' "$asset fixture" >"$fixture/v$version/$asset"
  (cd "$fixture/v$version" && shasum -a 256 "$asset") >>"$fixture/v$version/SHA256SUMS"
done

cat >"$fake_bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
headers=""
output=""
write_format=""
url=""
fail_on_error=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    -D) headers=$2; shift 2 ;;
    -o) output=$2; shift 2 ;;
    -w) write_format=$2; shift 2 ;;
    --connect-timeout | --max-time | --retry | --proto) shift 2 ;;
    -f | -fsSL | --fail) fail_on_error=1; shift ;;
    --tlsv1.2 | --retry-all-errors | -L | -s | -S | -sSL | --silent | --show-error) shift ;;
    http://* | https://*) url=$1; shift ;;
    *) shift ;;
  esac
done
[ -n "$url" ] && [ -n "$output" ] || exit 2
relative=${url#*://*/}
relative=${relative#downloads/orgspace/}
status=200
source="${ORGSPACE_TEST_DISTRIBUTION_FIXTURE:?}/$relative"
if [[ "$relative" == v${ORGSPACE_TEST_VERSION:?}/missing-* ]]; then
  if [ "${ORGSPACE_TEST_DISTRIBUTION_MODE:-good}" = "unknown-html" ]; then
    printf '%s\n' '<div id="root"></div>' >"$output"
  else
    status=404
    printf '%s\n' 'not found' >"$output"
  fi
elif [ ! -f "$source" ]; then
  exit 22
else
  /bin/cp "$source" "$output"
fi
if [ -n "$headers" ]; then
  length=$(wc -c <"$output" | tr -d ' ')
  {
    printf 'HTTP/1.1 %s Fixture\r\n' "$status"
    printf 'content-length: %s\r\n' "$length"
    case "$relative:${ORGSPACE_TEST_DISTRIBUTION_MODE:-good}" in
      install-skill.sh:stable-immutable) printf 'cache-control: public, max-age=31536000, immutable\r\n' ;;
      install-skill.sh:*) printf 'cache-control: no-cache\r\n' ;;
      *:version-no-immutable) printf 'cache-control: public, max-age=60\r\n' ;;
      *) printf 'cache-control: public, max-age=31536000, immutable\r\n' ;;
    esac
    printf '\r\n'
  } >"$headers"
fi
if [ -n "$write_format" ]; then printf '%s' "$status"; fi
if [ "$status" -ge 400 ] && [ "$fail_on_error" = "1" ]; then exit 22; fi
EOF
chmod +x "$fake_bin/curl"

run_smoke() {
  PATH="$fake_bin:$PATH" \
    ORGSPACE_DISTRIBUTION_SMOKE_TESTING=1 \
    ORGSPACE_DISTRIBUTION_BASE_URL="http://fixture.test/downloads/orgspace" \
    ORGSPACE_TEST_DISTRIBUTION_FIXTURE="$fixture" \
    ORGSPACE_TEST_VERSION="$version" \
    ORGSPACE_TEST_DISTRIBUTION_MODE="${1:-good}" \
    "$smoke"
}

expect_failure() {
  expected=$1
  shift
  set +e
  output="$("$@" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ] || [[ "$output" != *"$expected"* ]]; then
    printf 'expected failure containing %s; status=%s output=%s\n' "$expected" "$status" "$output" >&2
    exit 1
  fi
}

run_smoke good | grep -q 'public distribution: PASS'
expect_failure "stable installer cache policy is unsafe" run_smoke stable-immutable
expect_failure "versioned asset is missing immutable caching" run_smoke version-no-immutable
expect_failure "unknown asset must return 404" run_smoke unknown-html

cp "$fixture/v$version/${assets[0]}" "$temporary_root/asset.saved"
printf '%s\n' 'tampered' >"$fixture/v$version/${assets[0]}"
expect_failure "checksum validation failed" run_smoke good
mv "$temporary_root/asset.saved" "$fixture/v$version/${assets[0]}"

mv "$fixture/v$version/${assets[3]}" "$temporary_root/missing.saved"
expect_failure "failed to download" run_smoke good
mv "$temporary_root/missing.saved" "$fixture/v$version/${assets[3]}"

echo "smoke-public-distribution.self-test: PASS"
