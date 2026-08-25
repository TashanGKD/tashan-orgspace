#!/usr/bin/env bash
set -euo pipefail

repository_root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
release_file="$repository_root/release/cli-release.json"

die() {
  echo "smoke-public-distribution: $*" >&2
  exit 1
}

metadata="$(node -e '
  const fs = require("node:fs");
  const release = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const exact = "https://orgspace.tashan.chat/downloads/orgspace";
  if (release.distributionBaseUrl !== exact) process.exit(42);
  process.stdout.write([
    release.version,
    release.distributionBaseUrl,
    release.skillAsset,
    ...release.platforms.map((entry) => entry.asset),
  ].join("\t"));
' "$release_file")" || die "release distribution contract is invalid"
IFS=$'\t' read -r version configured_base skill_asset cli_arm cli_x64 cli_linux <<<"$metadata"

if [ "${ORGSPACE_DISTRIBUTION_SMOKE_TESTING:-0}" = "1" ]; then
  base_url=${ORGSPACE_DISTRIBUTION_BASE_URL:-$configured_base}
  download_options=(-f -s -S -L --connect-timeout 2 --max-time 10)
  probe_options=(-s -S -L --connect-timeout 2 --max-time 10)
else
  base_url=$configured_base
  download_options=(-f -s -S -L --proto '=https' --tlsv1.2 --connect-timeout 10 --max-time 180 --retry 2 --retry-all-errors)
  probe_options=(-s -S -L --proto '=https' --tlsv1.2 --connect-timeout 10 --max-time 30)
fi

temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/orgspace-public-smoke.XXXXXX")"
trap 'rm -rf "$temporary_root"' EXIT INT TERM

header_value() {
  name=$1
  file=$2
  awk -v wanted="$name" '
    BEGIN { IGNORECASE = 1 }
    $0 ~ "^" wanted ":" {
      sub(/^[^:]+:[[:space:]]*/, ""); sub(/\r$/, ""); value = $0
    }
    END { print value }
  ' "$file"
}

download() {
  relative=$1
  body="$temporary_root/${relative//\//_}"
  headers="$body.headers"
  if ! curl "${download_options[@]}" -D "$headers" -o "$body" "$base_url/$relative"; then
    die "failed to download $relative"
  fi
  declared_length="$(header_value Content-Length "$headers")"
  actual_length="$(wc -c <"$body" | tr -d ' ')"
  [ "$declared_length" = "$actual_length" ] || die "Content-Length mismatch for $relative"
  printf '%s\t%s\n' "$body" "$headers"
}

IFS=$'\t' read -r stable_body stable_headers < <(download install-skill.sh)
stable_cache="$(header_value Cache-Control "$stable_headers")"
[[ "$stable_cache" == *"no-cache"* ]] && [[ "$stable_cache" != *"immutable"* ]] ||
  die "stable installer cache policy is unsafe"

version_prefix="v$version"
version_files=("SHA256SUMS" "$skill_asset" "$cli_arm" "$cli_x64" "$cli_linux")
for file in "${version_files[@]}"; do
  IFS=$'\t' read -r body headers < <(download "$version_prefix/$file")
  cache="$(header_value Cache-Control "$headers")"
  [[ "$cache" == *"immutable"* ]] || die "versioned asset is missing immutable caching: $file"
done

checksums="$temporary_root/${version_prefix}_SHA256SUMS"
[ "$(awk 'NF { count += 1 } END { print count + 0 }' "$checksums")" = "4" ] ||
  die "SHA256SUMS must contain exactly four entries"
for asset in "$skill_asset" "$cli_arm" "$cli_x64" "$cli_linux"; do
  count="$(awk -v file="$asset" '$2 == file { count += 1 } END { print count + 0 }' "$checksums")"
  [ "$count" = "1" ] || die "checksum entry must appear exactly once for $asset"
  expected="$(awk -v file="$asset" '$2 == file { print $1 }' "$checksums")"
  actual="$(shasum -a 256 "$temporary_root/${version_prefix}_$asset" | awk '{print $1}')"
  [ "$expected" = "$actual" ] || die "checksum validation failed for $asset"
done

unknown_body="$temporary_root/unknown"
unknown_status="$(curl "${probe_options[@]}" -o "$unknown_body" -w '%{http_code}' "$base_url/$version_prefix/missing-smoke-asset")" ||
  die "unknown asset probe failed"
[ "$unknown_status" = "404" ] || die "unknown asset must return 404"

printf 'public distribution: PASS (v%s, 4 archives, official HTTPS mirror)\n' "$version"
