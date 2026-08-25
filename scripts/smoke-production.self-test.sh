#!/usr/bin/env bash
set -euo pipefail

repository_root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
smoke="$repository_root/scripts/smoke-production.sh"
temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/orgspace-smoke-test.XXXXXX")"
fake_bin="$temporary_root/bin"
smoke_log="$temporary_root/smoke.log"
mkdir -p "$fake_bin"
trap 'rm -rf "$temporary_root"' EXIT INT TERM

cat > "$fake_bin/curl" <<'EOF'
#!/usr/bin/env bash
set -eu
output_file=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) output_file="$2"; shift 2 ;;
    http://*|https://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
printf 'curl %s\n' "$url" >> "${ORGSPACE_TEST_SMOKE_LOG:?}"
case "${FAKE_HEALTH_MODE:-ok}" in
  redirect) code=302; effective="https://wrong.tashan.chat/v1/health"; body='redirect' ;;
  malformed) code=200; effective="$url"; body='not-json' ;;
  wrong-version) code=200; effective="$url"; body='{"status":"ok","version":"9.9.9"}' ;;
  *) code=200; effective="$url"; body='{"status":"ok","version":"0.1.0-alpha.1"}' ;;
esac
printf '%s' "$body" > "$output_file"
printf '%s\t%s' "$code" "$effective"
EOF

cat > "$fake_bin/torg" <<'EOF'
#!/usr/bin/env bash
set -eu
printf 'torg %s\n' "$*" >> "${ORGSPACE_TEST_SMOKE_LOG:?}"
if [ "${FAKE_TORG_SECRET:-0}" = "1" ]; then
  echo '{"accessToken":"eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0ZXN0In0.signature"}'
  exit 0
fi
case "$*" in
  *"capability list"*) echo '{"items":[]}' ;;
  *"auth login"*) cat >/dev/null; echo '{"account":{"id":"00000000-0000-4000-8000-000000000001"},"deviceId":"00000000-0000-4000-8000-000000000002"}' ;;
  *"device list"*) echo '{"items":[{"id":"00000000-0000-4000-8000-000000000002","current":true}]}' ;;
  *"device revoke"*) echo '{"deviceId":"00000000-0000-4000-8000-000000000002","revoked":true}' ;;
  *"auth whoami"*)
    if grep -q 'device revoke' "${ORGSPACE_TEST_SMOKE_LOG:?}" && [ "${FAKE_REVOKED_STILL_VALID:-0}" != "1" ]; then
      echo 'error [DEVICE_REVOKED]: device was revoked' >&2
      exit 3
    fi
    echo '{"account":{"id":"00000000-0000-4000-8000-000000000001"}}'
    ;;
  *) echo '{}' ;;
esac
EOF

cat > "$fake_bin/ssh" <<'EOF'
#!/usr/bin/env bash
set -eu
printf 'ssh %s\n' "$*" >> "${ORGSPACE_TEST_SMOKE_LOG:?}"
EOF

chmod +x "$fake_bin/curl" "$fake_bin/torg" "$fake_bin/ssh"

run_smoke() {
  PATH="$fake_bin:$PATH" ORGSPACE_SMOKE_TESTING=1 \
    ORGSPACE_TEST_SMOKE_LOG="$smoke_log" "$smoke" "$@"
}

expect_failure() {
  expected="$1"
  shift
  set +e
  output="$("$@" 2>&1)"
  smoke_rc=$?
  set -e
  if [ "$smoke_rc" -eq 0 ]; then
    echo "expected failure containing: $expected" >&2
    exit 1
  fi
  case "$output" in
    *"$expected"*) ;;
    *) printf 'missing %s\n%s\n' "$expected" "$output" >&2; exit 1 ;;
  esac
}

: > "$smoke_log"
run_smoke >/dev/null
grep -q 'curl https://orgspace.tashan.chat/v1/health' "$smoke_log"
grep -q 'torg --json capability list' "$smoke_log"
if grep -Eq 'auth (login|register)|device revoke' "$smoke_log"; then
  echo "default smoke mutated an account" >&2
  exit 1
fi

for mode_and_message in \
  'redirect|expected HTTPS 200 without redirect' \
  'malformed|health returned malformed JSON' \
  'wrong-version|health version mismatch'; do
  mode="${mode_and_message%%|*}"
  message="${mode_and_message#*|}"
  : > "$smoke_log"
  expect_failure "$message" env PATH="$fake_bin:$PATH" ORGSPACE_SMOKE_TESTING=1 \
    ORGSPACE_TEST_SMOKE_LOG="$smoke_log" FAKE_HEALTH_MODE="$mode" "$smoke"
done

: > "$smoke_log"
expect_failure "CLI emitted secret-like output" env PATH="$fake_bin:$PATH" \
  ORGSPACE_SMOKE_TESTING=1 ORGSPACE_TEST_SMOKE_LOG="$smoke_log" FAKE_TORG_SECRET=1 "$smoke"

: > "$smoke_log"
expect_failure "revoked device session remained usable" env PATH="$fake_bin:$PATH" \
  ORGSPACE_SMOKE_TESTING=1 ORGSPACE_TEST_SMOKE_LOG="$smoke_log" FAKE_REVOKED_STILL_VALID=1 \
  "$smoke" --account-lifecycle --credentials-stdin <<'EOF'
+8613800138000
CorrectHorseBattery9
EOF


mv "$fake_bin/torg" "$fake_bin/torg.disabled"
: > "$smoke_log"
run_smoke --recovery-check --confirm-production >/dev/null
grep -q 'start-tunnel.sh.*--stop.*start-tunnel.sh.*--apply' "$smoke_log"
mv "$fake_bin/torg.disabled" "$fake_bin/torg"

echo "smoke-production.self-test: PASS"
