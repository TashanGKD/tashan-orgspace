#!/usr/bin/env bash
set -euo pipefail

repository_root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
deployer="$repository_root/scripts/deploy-orgspace.sh"
temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/orgspace-deployer-test.XXXXXX")"
fake_bin="$temporary_root/bin"
transport_log="$temporary_root/transport.log"
mkdir -p "$fake_bin"
trap 'rm -rf "$temporary_root"' EXIT INT TERM

cat > "$fake_bin/git" <<'EOF'
#!/usr/bin/env bash
set -eu
case "$*" in
  *"rev-parse HEAD"*) printf '%040d\n' 0 | tr '0' 'a' ;;
  *"ls-files -z"*) test "${FAKE_GIT_LIST_FAIL:-0}" != "1" ;;
  *"diff --quiet"*) test "${FAKE_GIT_DIRTY:-0}" != "1" ;;
  *"diff --cached --quiet"*) test "${FAKE_GIT_STAGED_DIRTY:-0}" != "1" ;;
  *) exit 0 ;;
esac
EOF

cat > "$fake_bin/ssh" <<'EOF'
#!/usr/bin/env bash
set -eu
printf 'ssh %s\n' "$*" >> "${ORGSPACE_TEST_TRANSPORT_LOG:?}"
case "$*" in
  *"stat -c %a"*) printf '%s\n' "${FAKE_SECRET_MODE:-600}" ;;
  *"curl -fsS"*) printf '%s\n' '{"status":"ok","version":"0.1.0-alpha.2"}' ;;
esac
EOF

cat > "$fake_bin/rsync" <<'EOF'
#!/usr/bin/env bash
set -eu
printf 'rsync %s\n' "$*" >> "${ORGSPACE_TEST_TRANSPORT_LOG:?}"
test "${FAKE_RSYNC_FAIL:-0}" != "1"
EOF

chmod +x "$fake_bin/git" "$fake_bin/ssh" "$fake_bin/rsync"

run_deployer() {
  PATH="$fake_bin:$PATH" \
    ORGSPACE_DEPLOY_TESTING=1 \
    ORGSPACE_TEST_TRANSPORT_LOG="$transport_log" \
    "$deployer" "$@"
}

expect_failure() {
  expected="$1"
  shift
  set +e
  output="$("$@" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "expected failure containing: $expected" >&2
    exit 1
  fi
  case "$output" in
    *"$expected"*) ;;
    *)
      echo "missing failure text: $expected" >&2
      printf '%s\n' "$output" >&2
      exit 1
      ;;
  esac
}

: > "$transport_log"
default_output="$(run_deployer)"
case "$default_output" in
  *"DRY-RUN"*"/home/aup/tashan-orgspace"*) ;;
  *) echo "default invocation did not print the bounded dry-run plan" >&2; exit 1 ;;
esac
test ! -s "$transport_log"

: > "$transport_log"
expect_failure "tracked worktree must be clean" env \
  PATH="$fake_bin:$PATH" ORGSPACE_DEPLOY_TESTING=1 \
  ORGSPACE_TEST_TRANSPORT_LOG="$transport_log" FAKE_GIT_DIRTY=1 \
  "$deployer" --apply --confirm-production
test ! -s "$transport_log"

: > "$transport_log"
expect_failure "remote secret file must have mode 600" env \
  PATH="$fake_bin:$PATH" ORGSPACE_DEPLOY_TESTING=1 \
  ORGSPACE_TEST_TRANSPORT_LOG="$transport_log" FAKE_SECRET_MODE=644 \
  "$deployer" --apply --confirm-production
if grep -q '^rsync ' "$transport_log"; then
  echo "rsync ran before secret permission rejection" >&2
  exit 1
fi

unsafe_contract="$temporary_root/unsafe-contract.json"
cat > "$unsafe_contract" <<'EOF'
{
  "publicOrigin": "https://orgspace.tashan.chat",
  "healthPath": "/v1/health",
  "aupHostAlias": "aup-server",
  "ecsHostAlias": "tashan-ecs",
  "remoteRoot": "/home/aup/other",
  "composeProject": "other-project",
  "aupLoopbackPort": 44110,
  "ecsLoopbackPort": 14010,
  "ecsCertificate": "/etc/ssl/wildcard-tashan/fullchain.cer",
  "ecsCertificateKey": "/etc/ssl/wildcard-tashan/tashan.chat.key"
}
EOF
: > "$transport_log"
expect_failure "deployment contract is outside the OrgSpace boundary" env \
  PATH="$fake_bin:$PATH" ORGSPACE_DEPLOY_TESTING=1 \
  ORGSPACE_TEST_TRANSPORT_LOG="$transport_log" ORGSPACE_DEPLOY_CONTRACT="$unsafe_contract" \
  "$deployer" --apply --confirm-production
test ! -s "$transport_log"

: > "$transport_log"
expect_failure "rsync failed" env \
  PATH="$fake_bin:$PATH" ORGSPACE_DEPLOY_TESTING=1 \
  ORGSPACE_TEST_TRANSPORT_LOG="$transport_log" FAKE_RSYNC_FAIL=1 \
  "$deployer" --apply --confirm-production
if grep -q '\.deployed-commit' "$transport_log"; then
  echo "failed sync wrote deployed commit" >&2
  exit 1
fi

: > "$transport_log"
expect_failure "tracked file sync failed" env \
  PATH="$fake_bin:$PATH" ORGSPACE_DEPLOY_TESTING=1 \
  ORGSPACE_TEST_TRANSPORT_LOG="$transport_log" FAKE_GIT_LIST_FAIL=1 \
  "$deployer" --apply --confirm-production
if grep -q '\.deployed-commit' "$transport_log"; then
  echo "failed tracked-file enumeration wrote deployed commit" >&2
  exit 1
fi
if ! grep -q 'staging.*rm -rf' "$transport_log"; then
  echo "failed sync did not clean the bounded staging directory" >&2
  exit 1
fi

: > "$transport_log"
run_deployer --apply --confirm-production >/dev/null
grep -q '^rsync ' "$transport_log"
grep -q '\.deployed-commit' "$transport_log"
grep -q "mkdir -p '/home/aup/tashan-orgspace/shared/public-downloads'" "$transport_log"
if grep '^ssh ' "$transport_log" | grep -qv -- '-o BatchMode=yes -o ConnectTimeout=10'; then
  echo "deployment SSH call is missing fail-fast connection options" >&2
  exit 1
fi
grep '^rsync ' "$transport_log" | grep -q -- '-e ssh -o BatchMode=yes -o ConnectTimeout=10'
grep '^ssh ' "$transport_log" | grep -q -- '-o ControlMaster=yes -o ControlPersist=120'
grep '^ssh ' "$transport_log" | grep -q -- '-O exit'
if grep -Eq '/home/aup/(panshi|cognitive-ask-platform)' "$transport_log"; then
  echo "deployment escaped its filesystem boundary" >&2
  exit 1
fi
offending_compose="$(grep 'docker compose --env-file' "$transport_log" | grep -v -- "-p 'tashan-orgspace-prod'" || true)"
if [ -n "$offending_compose" ]; then
  echo "deployment escaped its Compose project boundary" >&2
  printf '%s\n' "$offending_compose" >&2
  exit 1
fi

grep -q 'git -C "$repository_root" diff --quiet -- \.' "$deployer"
grep -q 'git -C "$repository_root" diff --cached --quiet -- \.' "$deployer"

echo "deploy-orgspace.self-test: PASS"
