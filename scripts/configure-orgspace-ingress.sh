#!/usr/bin/env bash
set -euo pipefail

repository_root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
contract="$repository_root/deploy/production-contract.json"
template="$repository_root/deploy/nginx/ecs-orgspace.conf"
if [ -n "${ORGSPACE_INGRESS_TEMPLATE:-}" ]; then
  [ "${ORGSPACE_INGRESS_TESTING:-0}" = "1" ] || {
    echo "configure-orgspace-ingress: template override is test-only" >&2
    exit 1
  }
  template="$ORGSPACE_INGRESS_TEMPLATE"
fi

die() {
  echo "configure-orgspace-ingress: $*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage:
  scripts/configure-orgspace-ingress.sh
  scripts/configure-orgspace-ingress.sh --preflight
  scripts/configure-orgspace-ingress.sh --apply --confirm-production

No arguments prints a DRY-RUN plan and makes no remote changes.
EOF
}

values="$(node -e '
  const fs = require("node:fs");
  const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (c.publicOrigin !== "https://orgspace.tashan.chat" || c.healthPath !== "/v1/health") process.exit(42);
  if (c.aupHostAlias !== "aup-server" || c.ecsHostAlias !== "tashan-ecs") process.exit(42);
  if (c.ecsLoopbackPort !== 14010 || c.aupLoopbackPort !== 44110) process.exit(42);
  process.stdout.write([c.publicOrigin,c.healthPath,c.aupHostAlias,c.ecsHostAlias,String(c.ecsLoopbackPort),c.ecsCertificate,c.ecsCertificateKey,c.remoteRoot].join("\t"));
' "$contract")" || die "production contract is invalid"
IFS="$(printf '\t')" read -r public_origin health_path aup_host ecs_host ecs_port certificate certificate_key remote_root <<EOF
$values
EOF

vhost="/etc/nginx/sites-available/orgspace.tashan.chat"
enabled_vhost="/etc/nginx/sites-enabled/orgspace.tashan.chat"
remote_candidate="$vhost.next"

validate_template() {
  node -e '
    const fs = require("node:fs");
    const text = fs.readFileSync(process.argv[1], "utf8");
    const required = [
      "listen 443 ssl http2;",
      "server_name orgspace.tashan.chat;",
      "ssl_certificate /etc/ssl/wildcard-tashan/fullchain.cer;",
      "ssl_certificate_key /etc/ssl/wildcard-tashan/tashan.chat.key;",
      "proxy_set_header X-Forwarded-For $remote_addr;",
      "proxy_pass http://127.0.0.1:14010;",
    ];
    if (required.some((value) => !text.includes(value))) process.exit(42);
    const upstreams = [...text.matchAll(/proxy_pass\s+([^;]+);/g)].map((match) => match[1]);
    if (upstreams.length !== 1 || upstreams[0] !== "http://127.0.0.1:14010") process.exit(42);
  ' "$template" || die "ingress template violates the production contract"
}

require_clean_worktree() {
  git -C "$repository_root" diff --quiet -- . || die "tracked worktree must be clean"
  git -C "$repository_root" diff --cached --quiet -- . || die "tracked worktree must be clean"
}

preflight() {
  validate_template
  node "$repository_root/scripts/check-production-contract.mjs" >/dev/null
  ssh "$ecs_host" "set -eu; command -v nginx >/dev/null; test -r '$certificate'; test -r '$certificate_key'; if ss -ltn | grep -q ':$ecs_port '; then pgrep -fa autossh | grep -q '127.0.0.1:$ecs_port:127.0.0.1:44110'; fi"
  ssh "$aup_host" "set -eu; test -x '$remote_root/current/deploy/start-tunnel.sh'; command -v autossh >/dev/null; test -r /home/aup/.ssh/tashan_tunnel"
  echo "configure-orgspace-ingress preflight: PASS"
}

restore_vhost() {
  backup="$1"
  prior_state="$2"
  ssh "$ecs_host" "set -eu; echo restore-orgspace-vhost >/dev/null; if test '$prior_state' = present; then cp '$backup' '$vhost'; ln -sfn '$vhost' '$enabled_vhost'; else rm -f '$vhost' '$enabled_vhost'; fi; nginx -t; nginx -s reload; rm -f '$remote_candidate' '$backup'" || true
}

apply_ingress() {
  require_clean_worktree
  preflight
  backup="$vhost.backup.$$"
  prior_state="$(ssh "$ecs_host" "if test -e '$vhost'; then cp '$vhost' '$backup'; echo present; else echo absent; fi")"
  scp "$template" "$ecs_host:$remote_candidate"
  if ! ssh "$ecs_host" "set -eu; mv '$remote_candidate' '$vhost'; ln -sfn '$vhost' '$enabled_vhost'; if nginx -t; then nginx -s reload; else echo restore-orgspace-vhost >/dev/null; if test '$prior_state' = present; then cp '$backup' '$vhost'; else rm -f '$vhost' '$enabled_vhost'; fi; nginx -t; nginx -s reload; exit 1; fi"; then
    die "ECS nginx validation failed; prior OrgSpace vhost restored"
  fi
  if ! ssh "$aup_host" "'$remote_root/current/deploy/start-tunnel.sh' --apply --confirm-production"; then
    restore_vhost "$backup" "$prior_state"
    die "AUP tunnel start failed; prior OrgSpace vhost restored"
  fi
  if ! ssh "$ecs_host" "curl -fsS 'http://127.0.0.1:$ecs_port$health_path' >/dev/null"; then
    restore_vhost "$backup" "$prior_state"
    die "ECS loopback health failed; prior OrgSpace vhost restored"
  fi
  health="$(curl --fail --silent --show-error --proto '=https' --tlsv1.2 "$public_origin$health_path")" || {
    restore_vhost "$backup" "$prior_state"
    die "public HTTPS health failed; prior OrgSpace vhost restored"
  }
  HEALTH="$health" node -e 'const h=JSON.parse(process.env.HEALTH);if(h.status!=="ok")process.exit(1)' || {
    restore_vhost "$backup" "$prior_state"
    die "public HTTPS health returned an invalid body; prior OrgSpace vhost restored"
  }
  ssh "$ecs_host" "rm -f '$backup' '$remote_candidate'"
  echo "configure-orgspace-ingress: active at $public_origin"
}

first_argument="${1:-}"
case "$#:$first_argument" in
  0:)
    validate_template
    cat <<EOF
OrgSpace ingress DRY-RUN
  ECS vhost: $vhost
  ECS upstream: 127.0.0.1:$ecs_port
  AUP tunnel target: 127.0.0.1:44110
  public origin: $public_origin

Run --preflight for read-only remote checks.
Run --apply --confirm-production to install only this vhost and tunnel.
EOF
    ;;
  1:--preflight)
    preflight
    ;;
  2:--apply)
    [ "$2" = "--confirm-production" ] || die "--apply requires --confirm-production"
    apply_ingress
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
