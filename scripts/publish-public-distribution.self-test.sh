#!/usr/bin/env bash
set -euo pipefail

repository_root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
publisher="$repository_root/scripts/publish-public-distribution.sh"
temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/orgspace-publisher-test.XXXXXX")"
fake_bin="$temporary_root/bin"
source_dir="$temporary_root/source"
transport_log="$temporary_root/transport.log"
mkdir -p "$fake_bin" "$source_dir"
trap 'rm -rf "$temporary_root"' EXIT INT TERM

version="$(node -p "JSON.parse(require('node:fs').readFileSync('$repository_root/release/cli-release.json')).version")"
assets=(
  "tashan-orgspace-skill-v$version.tar.gz"
  "torg-v$version-darwin-arm64.tar.gz"
  "torg-v$version-darwin-x64.tar.gz"
  "torg-v$version-linux-x64.tar.gz"
)

make_archives() {
  local staging="$temporary_root/archive-staging"
  rm -rf "$staging"
  mkdir -p "$staging"
  for asset in "${assets[@]}"; do
    root="${asset%.tar.gz}"
    if [[ "$asset" == tashan-orgspace-skill-* ]]; then root="tashan-orgspace"; fi
    mkdir -p "$staging/$root"
    printf '%s\n' "$asset" >"$staging/$root/fixture"
    tar -czf "$source_dir/$asset" -C "$staging" "$root"
    rm -rf "$staging/$root"
  done
  : >"$source_dir/SHA256SUMS"
  for asset in "${assets[@]}"; do
    (cd "$source_dir" && shasum -a 256 "$asset") >>"$source_dir/SHA256SUMS"
  done
}
make_archives

cat >"$fake_bin/git" <<'EOF'
#!/usr/bin/env bash
set -eu
case "$*" in
  *"diff --quiet"*) test "${FAKE_GIT_DIRTY:-0}" != "1" ;;
  *"diff --cached --quiet"*) test "${FAKE_GIT_STAGED_DIRTY:-0}" != "1" ;;
  *"describe --exact-match --tags HEAD"*) printf 'v%s\n' "${FAKE_TAG_VERSION:-${ORGSPACE_TEST_VERSION:-1.0.0}}" ;;
  *"rev-parse --show-toplevel"*) printf '%s\n' "${ORGSPACE_TEST_REPOSITORY_ROOT:?}" ;;
  *) exit 0 ;;
esac
EOF

cat >"$fake_bin/ssh" <<'EOF'
#!/usr/bin/env bash
set -eu
printf 'ssh %s\n' "$*" >>"${ORGSPACE_TEST_TRANSPORT_LOG:?}"
case "$*" in
  *"test ! -e"*) test "${FAKE_REMOTE_EXISTS:-0}" != "1" ;;
esac
EOF

cat >"$fake_bin/rsync" <<'EOF'
#!/usr/bin/env bash
set -eu
printf 'rsync %s\n' "$*" >>"${ORGSPACE_TEST_TRANSPORT_LOG:?}"
test "${FAKE_RSYNC_FAIL:-0}" != "1"
EOF
chmod +x "$fake_bin/git" "$fake_bin/ssh" "$fake_bin/rsync"

run_publisher() {
  PATH="$fake_bin:$PATH" \
    ORGSPACE_PUBLISH_TESTING=1 \
    ORGSPACE_TEST_VERSION="$version" \
    ORGSPACE_TEST_REPOSITORY_ROOT="$repository_root" \
    ORGSPACE_TEST_TRANSPORT_LOG="$transport_log" \
    "$publisher" "$@"
}

expect_failure() {
  local expected="$1"
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

: >"$transport_log"
default_output="$(run_publisher)"
[[ "$default_output" == *"DRY-RUN"* ]]
test ! -s "$transport_log"

: >"$transport_log"
expect_failure "requires --confirm-production" run_publisher --apply --source-dir "$source_dir"
test ! -s "$transport_log"

missing="$source_dir/${assets[3]}"
mv "$missing" "$missing.saved"
: >"$transport_log"
expect_failure "release directory must contain exactly" run_publisher --preflight --source-dir "$source_dir"
test ! -s "$transport_log"
mv "$missing.saved" "$missing"

cp "$source_dir/SHA256SUMS" "$temporary_root/SHA256SUMS.saved"
head -n 1 "$source_dir/SHA256SUMS" >>"$source_dir/SHA256SUMS"
: >"$transport_log"
expect_failure "checksum entry must appear exactly once" run_publisher --preflight --source-dir "$source_dir"
test ! -s "$transport_log"
mv "$temporary_root/SHA256SUMS.saved" "$source_dir/SHA256SUMS"

malicious="$temporary_root/malicious-archive"
mkdir -p "$malicious/tashan-orgspace"
ln -s /bin/sh "$malicious/tashan-orgspace/escape"
tar -czf "$source_dir/${assets[0]}" -C "$malicious" tashan-orgspace
: >"$source_dir/SHA256SUMS"
for asset in "${assets[@]}"; do
  (cd "$source_dir" && shasum -a 256 "$asset") >>"$source_dir/SHA256SUMS"
done
: >"$transport_log"
expect_failure "release archives must not contain links" run_publisher --preflight --source-dir "$source_dir"
test ! -s "$transport_log"
make_archives

: >"$transport_log"
expect_failure "tracked worktree must be clean" env FAKE_GIT_DIRTY=1 \
  PATH="$fake_bin:$PATH" ORGSPACE_PUBLISH_TESTING=1 \
  ORGSPACE_TEST_REPOSITORY_ROOT="$repository_root" ORGSPACE_TEST_TRANSPORT_LOG="$transport_log" \
  "$publisher" --preflight --source-dir "$source_dir"
test ! -s "$transport_log"

: >"$transport_log"
expect_failure "exact tag must be v$version" env FAKE_TAG_VERSION=0.0.0 \
  PATH="$fake_bin:$PATH" ORGSPACE_PUBLISH_TESTING=1 \
  ORGSPACE_TEST_VERSION="$version" ORGSPACE_TEST_REPOSITORY_ROOT="$repository_root" ORGSPACE_TEST_TRANSPORT_LOG="$transport_log" \
  "$publisher" --preflight --source-dir "$source_dir"
test ! -s "$transport_log"

: >"$transport_log"
run_publisher --preflight --source-dir "$source_dir" >/dev/null
grep -q '^ssh ' "$transport_log"
test "$(grep -c '^rsync ' "$transport_log" || true)" -eq 0

: >"$transport_log"
expect_failure "remote version already exists" env FAKE_REMOTE_EXISTS=1 \
  PATH="$fake_bin:$PATH" ORGSPACE_PUBLISH_TESTING=1 \
  ORGSPACE_TEST_REPOSITORY_ROOT="$repository_root" ORGSPACE_TEST_TRANSPORT_LOG="$transport_log" \
  "$publisher" --apply --confirm-production --source-dir "$source_dir"
test "$(grep -c '^rsync ' "$transport_log" || true)" -eq 0

: >"$transport_log"
run_publisher --apply --confirm-production --source-dir "$source_dir" >/dev/null
grep -q '^rsync ' "$transport_log"
grep -q '\.staging/v0\.1\.0-alpha\.3' "$transport_log"
grep -q 'mv.*v0\.1\.0-alpha\.3' "$transport_log"
grep -q 'install-skill\.sh' "$transport_log"

echo "publish-public-distribution.self-test: PASS"
