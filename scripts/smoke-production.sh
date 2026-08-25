#!/usr/bin/env bash
set -euo pipefail

repository_root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
contract="$repository_root/deploy/production-contract.json"
release_manifest="$repository_root/release/cli-release.json"

die() {
  echo "smoke-production: $*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage:
  scripts/smoke-production.sh
  scripts/smoke-production.sh --account-lifecycle --credentials-stdin
  scripts/smoke-production.sh --recovery-check --confirm-production

No arguments performs read-only HTTPS health and capability discovery.
Account lifecycle reads exactly two stdin lines: phone, then password.
EOF
}

contract_values="$(node -e '
  const fs = require("node:fs");
  const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (c.publicOrigin !== "https://orgspace.tashan.chat" || c.healthPath !== "/v1/health") process.exit(42);
  process.stdout.write([c.publicOrigin,c.healthPath,c.aupHostAlias,c.remoteRoot].join("\t"));
' "$contract")" || die "production contract is invalid"
IFS="$(printf '\t')" read -r public_origin health_path aup_host remote_root <<EOF
$contract_values
EOF
release_version="$(node -p "JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8')).version" "$release_manifest")"

temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/orgspace-production-smoke.XXXXXX")"
trap 'rm -rf "$temporary_root"' EXIT INT TERM

assert_json() {
  label="$1"
  value="$2"
  VALUE="$value" node -e 'JSON.parse(process.env.VALUE)' >/dev/null 2>&1 || die "$label returned malformed JSON"
}

assert_no_secrets() {
  label="$1"
  value="$2"
  if printf '%s' "$value" | grep -Eq '"(accessToken|refreshToken|password|code)"[[:space:]]*:|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.'; then
    die "$label emitted secret-like output"
  fi
}

read_health() {
  body_file="$temporary_root/health.json"
  metadata="$(curl --silent --show-error --proto '=https' --tlsv1.2 \
    --connect-timeout 5 --max-time 15 --max-redirs 0 \
    --output "$body_file" --write-out '%{http_code}\t%{url_effective}' \
    "$public_origin$health_path")" || die "public HTTPS health request failed"
  IFS="$(printf '\t')" read -r http_code effective_url <<EOF
$metadata
EOF
  if [ "$http_code" != "200" ] || [ "$effective_url" != "$public_origin$health_path" ]; then
    die "expected HTTPS 200 without redirect"
  fi
  health="$(cat "$body_file")"
  health_version="$(HEALTH="$health" node -e '
    try {
      const value = JSON.parse(process.env.HEALTH);
      if (value.status !== "ok" || typeof value.version !== "string") process.exit(1);
      process.stdout.write(value.version);
    } catch { process.exit(1); }
  ')" || die "health returned malformed JSON"
  [ "$health_version" = "$release_version" ] ||
    die "health version mismatch: expected $release_version, got $health_version"
}

cli_path=""
require_cli() {
  cli_path="$(command -v torg || true)"
  [ -n "$cli_path" ] || die "torg is required on PATH"
}

read_only_smoke() {
  require_cli
  read_health
  set +e
  capabilities="$($cli_path --json capability list 2>&1)"
  cli_rc=$?
  set -e
  [ "$cli_rc" -eq 0 ] || die "CLI capability discovery failed"
  assert_json "CLI capability discovery" "$capabilities"
  assert_no_secrets "CLI" "$capabilities"
  echo "smoke-production: PASS (HTTPS health and CLI capability discovery)"
}

account_lifecycle() {
  require_cli
  IFS= read -r phone || die "credentials stdin must contain phone and password"
  IFS= read -r password || die "credentials stdin must contain phone and password"
  case "$phone" in +[0-9]*) ;; *) die "credentials stdin phone must be E.164" ;; esac
  [ -n "$password" ] || die "credentials stdin password must not be empty"

  login_output="$(printf '%s\n' "$password" | "$cli_path" --json auth login --phone "$phone" --password-stdin)" ||
    die "CLI login failed"
  unset password
  assert_json "CLI login" "$login_output"
  assert_no_secrets "CLI login" "$login_output"

  whoami_output="$("$cli_path" --json auth whoami)" || die "CLI whoami failed after login"
  assert_json "CLI whoami" "$whoami_output"
  devices="$("$cli_path" --json device list)" || die "CLI device list failed"
  assert_json "CLI device list" "$devices"
  current_device="$(DEVICES="$devices" node -e '
    const value = JSON.parse(process.env.DEVICES);
    const current = value.items?.find((item) => item.current === true);
    if (typeof current?.id !== "string") process.exit(1);
    process.stdout.write(current.id);
  ')" || die "CLI device list did not identify the current device"

  revoke_key="production-smoke-revoke-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  revoke_output="$("$cli_path" --json device revoke "$current_device" --yes \
    --allow-current-device --idempotency-key "$revoke_key")" || die "CLI device revoke failed"
  assert_json "CLI device revoke" "$revoke_output"

  set +e
  post_revoke="$("$cli_path" --json auth whoami 2>&1)"
  post_revoke_rc=$?
  set -e
  [ "$post_revoke_rc" -ne 0 ] || die "revoked device session remained usable"
  assert_no_secrets "post-revoke error" "$post_revoke"
  echo "smoke-production: PASS (account login and current-device revocation)"
}

recovery_check() {
  ssh "$aup_host" "set -eu; '$remote_root/current/deploy/start-tunnel.sh' --stop --confirm-production; '$remote_root/current/deploy/start-tunnel.sh' --apply --confirm-production"
  read_health
  echo "smoke-production: PASS (tunnel stop/start recovery)"
}

first_argument="${1:-}"
case "$#:$first_argument" in
  0:)
    read_only_smoke
    ;;
  2:--account-lifecycle)
    [ "$2" = "--credentials-stdin" ] || die "--account-lifecycle requires --credentials-stdin"
    read_health
    account_lifecycle
    ;;
  2:--recovery-check)
    [ "$2" = "--confirm-production" ] || die "--recovery-check requires --confirm-production"
    recovery_check
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
