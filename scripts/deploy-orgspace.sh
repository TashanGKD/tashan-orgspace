#!/usr/bin/env bash
set -euo pipefail

repository_root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
default_contract="$repository_root/deploy/production-contract.json"
ssh_options=(-o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=2)
rsync_ssh="ssh -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=2"

orgspace_ssh() {
  ssh "${ssh_options[@]}" "$@"
}

die() {
  echo "deploy-orgspace: $*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage:
  scripts/deploy-orgspace.sh
  scripts/deploy-orgspace.sh --preflight
  scripts/deploy-orgspace.sh --apply --confirm-production
  scripts/deploy-orgspace.sh --rollback <commit> --confirm-production

No arguments prints a bounded DRY-RUN plan. It does not use SSH, sync files,
start containers, run migrations, or change production.
EOF
}

contract_path="$default_contract"
if [ -n "${ORGSPACE_DEPLOY_CONTRACT:-}" ]; then
  [ "${ORGSPACE_DEPLOY_TESTING:-0}" = "1" ] || die "contract override is test-only"
  contract_path="$ORGSPACE_DEPLOY_CONTRACT"
fi

contract_values="$(node -e '
  const fs = require("node:fs");
  const contract = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const exact = {
    publicOrigin: "https://orgspace.tashan.chat",
    healthPath: "/v1/health",
    aupHostAlias: "aup-server",
    ecsHostAlias: "tashan-ecs",
    remoteRoot: "/home/aup/tashan-orgspace",
    composeProject: "tashan-orgspace-prod",
    aupLoopbackPort: 44110,
    ecsLoopbackPort: 14010,
  };
  for (const [key, value] of Object.entries(exact)) {
    if (contract[key] !== value) process.exit(42);
  }
  process.stdout.write([
    contract.publicOrigin,
    contract.healthPath,
    contract.aupHostAlias,
    contract.remoteRoot,
    contract.composeProject,
    String(contract.aupLoopbackPort),
  ].join("\t"));
' "$contract_path")" || die "deployment contract is outside the OrgSpace boundary"

IFS="$(printf '\t')" read -r public_origin health_path aup_host remote_root compose_project aup_port <<EOF
$contract_values
EOF

[ "$remote_root" = "/home/aup/tashan-orgspace" ] || die "deployment contract is outside the OrgSpace boundary"
[ "$compose_project" = "tashan-orgspace-prod" ] || die "deployment contract is outside the OrgSpace boundary"
secret_file="$remote_root/shared/.env.production"

print_plan() {
  cat <<EOF
OrgSpace production DRY-RUN
  source: $repository_root (tracked files at HEAD only)
  AUP host: $aup_host
  remote root: $remote_root
  Compose project: $compose_project
  AUP listener: 127.0.0.1:$aup_port
  public health: $public_origin$health_path

Run --preflight for read-only remote checks.
Run --apply --confirm-production to mutate only this OrgSpace boundary.
EOF
}

require_clean_worktree() {
  git -C "$repository_root" diff --quiet -- . || die "tracked worktree must be clean"
  git -C "$repository_root" diff --cached --quiet -- . || die "tracked worktree must be clean"
}

validate_commit() {
  case "$1" in
    ""|*[!0-9a-f]*) die "commit must contain 7 to 40 lowercase hexadecimal characters" ;;
  esac
  [ "${#1}" -ge 7 ] && [ "${#1}" -le 40 ] ||
    die "commit must contain 7 to 40 lowercase hexadecimal characters"
}

read_only_preflight() {
  node "$repository_root/scripts/check-production-contract.mjs" >/dev/null
  orgspace_ssh "$aup_host" "set -eu; command -v docker >/dev/null; docker compose version >/dev/null; command -v curl >/dev/null; test -d '$remote_root' || test ! -e '$remote_root'; if ss -ltn | grep -q ':$aup_port '; then docker ps --format '{{.Names}}' | grep -q '^tashan-orgspace-prod-'; fi"
  secret_mode="$(orgspace_ssh "$aup_host" "if test -f '$secret_file'; then stat -c %a '$secret_file'; else echo missing; fi")"
  [ "$secret_mode" = "600" ] || die "remote secret file must have mode 600: $secret_file"
  echo "deploy-orgspace preflight: PASS ($aup_host $remote_root)"
}

compose_command() {
  release_path="$1"
  printf "docker compose --env-file '%s' -f '%s/deploy/compose.production.yml' -p '%s'" \
    "$secret_file" "$release_path" "$compose_project"
}

restore_previous_release() {
  previous_release="$1"
  if [ -n "$previous_release" ]; then
    previous_compose="$(compose_command "$previous_release")"
    orgspace_ssh "$aup_host" "set -eu; $previous_compose up -d --remove-orphans"
  else
    current_compose="$2"
    orgspace_ssh "$aup_host" "$current_compose down" >/dev/null 2>&1 || true
  fi
}

health_check() {
  orgspace_ssh "$aup_host" "set -eu; attempts=0; while test \"\$attempts\" -lt 30; do if body=\$(curl -fsS 'http://127.0.0.1:$aup_port$health_path'); then HEALTH=\"\$body\" node -e 'const h=JSON.parse(process.env.HEALTH);if(h.status!==\"ok\")process.exit(1)' && exit 0; fi; attempts=\$((attempts+1)); sleep 1; done; exit 1"
}

apply_release() {
  require_clean_worktree
  read_only_preflight
  commit="$(git -C "$repository_root" rev-parse HEAD)"
  validate_commit "$commit"
  release_path="$remote_root/releases/$commit"
  staging_path="$remote_root/staging/$commit-$$"
  previous_release="$(orgspace_ssh "$aup_host" "readlink -f '$remote_root/current' 2>/dev/null || true")"

  orgspace_ssh "$aup_host" "set -eu; mkdir -p '$remote_root/releases' '$remote_root/staging' '$remote_root/shared'; rm -rf '$staging_path'; mkdir -p '$staging_path'"
  if ! git -C "$repository_root" ls-files -z | rsync -a -e "$rsync_ssh" --from0 --files-from=- "$repository_root/" "$aup_host:$staging_path/"; then
    orgspace_ssh "$aup_host" "rm -rf '$staging_path'"
    die "tracked file sync failed: git enumeration or rsync failed; bounded staging directory was removed"
  fi

  staging_compose="$(compose_command "$staging_path")"
  if ! orgspace_ssh "$aup_host" "set -eu; cd '$staging_path'; $staging_compose config --quiet; $staging_compose build; $staging_compose run --rm migrate"; then
    orgspace_ssh "$aup_host" "rm -rf '$staging_path'"
    die "build or migration failed; deployed commit was not changed"
  fi

  orgspace_ssh "$aup_host" "set -eu; test ! -e '$release_path'; mv '$staging_path' '$release_path'"
  release_compose="$(compose_command "$release_path")"
  if ! orgspace_ssh "$aup_host" "set -eu; $release_compose up -d --remove-orphans"; then
    restore_previous_release "$previous_release" "$release_compose"
    die "production start failed; previous release was restored"
  fi
  if ! health_check >/dev/null; then
    restore_previous_release "$previous_release" "$release_compose"
    die "production health failed; previous release was restored"
  fi

  deployed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  orgspace_ssh "$aup_host" "set -eu; ln -sfn 'releases/$commit' '$remote_root/current.next'; mv -Tf '$remote_root/current.next' '$remote_root/current'; printf '%s\n' '$commit' > '$remote_root/.deployed-commit'; printf '%s\t%s\n' '$deployed_at' '$commit' >> '$remote_root/deploy-history.log'"
  echo "deploy-orgspace: deployed $commit to $remote_root"
}

rollback_release() {
  commit="$1"
  validate_commit "$commit"
  read_only_preflight
  release_path="$remote_root/releases/$commit"
  orgspace_ssh "$aup_host" "test -d '$release_path'" || die "rollback release does not exist: $commit"
  release_compose="$(compose_command "$release_path")"
  orgspace_ssh "$aup_host" "set -eu; $release_compose config --quiet; $release_compose up -d --remove-orphans"
  health_check >/dev/null || die "rollback release failed health; current pointer was not changed"
  rolled_back_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  orgspace_ssh "$aup_host" "set -eu; ln -sfn 'releases/$commit' '$remote_root/current.next'; mv -Tf '$remote_root/current.next' '$remote_root/current'; printf '%s\n' '$commit' > '$remote_root/.deployed-commit'; printf '%s\t%s\trollback\n' '$rolled_back_at' '$commit' >> '$remote_root/deploy-history.log'"
  echo "deploy-orgspace: rolled back to $commit"
}

first_argument="${1:-}"
case "$#:$first_argument" in
  0:)
    print_plan
    ;;
  1:--preflight)
    read_only_preflight
    ;;
  2:--apply)
    [ "$2" = "--confirm-production" ] || die "--apply requires --confirm-production"
    apply_release
    ;;
  3:--rollback)
    [ "$3" = "--confirm-production" ] || die "--rollback requires --confirm-production"
    rollback_release "$2"
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
