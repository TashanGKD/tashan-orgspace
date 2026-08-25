#!/usr/bin/env bash
set -euo pipefail

repository_root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
contract="$repository_root/deploy/production-contract.json"
state_dir="/home/aup/tashan-orgspace/tunnel"
if [ -n "${ORGSPACE_TUNNEL_STATE_DIR:-}" ]; then
  [ "${ORGSPACE_TUNNEL_TESTING:-0}" = "1" ] || {
    echo "start-tunnel: state directory override is test-only" >&2
    exit 1
  }
  state_dir="$ORGSPACE_TUNNEL_STATE_DIR"
fi

die() {
  echo "start-tunnel: $*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage:
  deploy/start-tunnel.sh
  deploy/start-tunnel.sh --status
  deploy/start-tunnel.sh --apply --confirm-production
  deploy/start-tunnel.sh --stop --confirm-production

No arguments prints help and makes no changes.
EOF
}

values="$(node -e '
  const fs = require("node:fs");
  const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (c.aupLoopbackPort !== 44110 || c.ecsLoopbackPort !== 14010) process.exit(42);
  process.stdout.write(`${c.ecsLoopbackPort}\t${c.aupLoopbackPort}`);
' "$contract")" || die "production tunnel ports are invalid"
IFS="$(printf '\t')" read -r ecs_port aup_port <<EOF
$values
EOF

pid_file="$state_dir/autossh.pid"
log_file="$state_dir/autossh.log"
key_file="/home/aup/.ssh/tashan_tunnel"
ecs_target="root@101.200.234.115"
reverse_forward="127.0.0.1:$ecs_port:127.0.0.1:$aup_port"

read_pid() {
  [ -f "$pid_file" ] || return 1
  pid="$(cat "$pid_file")"
  case "$pid" in ""|*[!0-9]*) return 1 ;; esac
  printf '%s\n' "$pid"
}

is_managed_process() {
  pid="$1"
  kill -0 "$pid" >/dev/null 2>&1 || return 1
  command_line="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  case "$command_line" in
    *autossh*"-R $reverse_forward"*"$ecs_target"*) return 0 ;;
    *) return 1 ;;
  esac
}

status() {
  if pid="$(read_pid 2>/dev/null)" && is_managed_process "$pid"; then
    echo "start-tunnel: running (pid $pid, ECS loopback $ecs_port -> AUP loopback $aup_port)"
    return 0
  fi
  echo "start-tunnel: stopped"
  return 1
}

apply_tunnel() {
  command -v autossh >/dev/null || die "autossh is required"
  if [ "${ORGSPACE_TUNNEL_TESTING:-0}" != "1" ]; then
    [ -f "$key_file" ] || die "tunnel key is missing: $key_file"
    key_mode="$(stat -c %a "$key_file")"
    [ "$key_mode" = "600" ] || die "tunnel key must have mode 600"
  fi
  if existing_pid="$(read_pid 2>/dev/null)"; then
    if is_managed_process "$existing_pid"; then
      echo "start-tunnel: already running (pid $existing_pid)"
      return 0
    fi
    kill -0 "$existing_pid" >/dev/null 2>&1 &&
      die "pid file points to an unmanaged live process: $existing_pid"
  fi

  mkdir -p "$state_dir"
  chmod 700 "$state_dir"
  rm -f "$pid_file"
  nohup autossh -M 0 -N \
    -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=3 \
    -i "$key_file" \
    -R "$reverse_forward" \
    "$ecs_target" >>"$log_file" 2>&1 &
  tunnel_pid=$!
  sleep 1
  kill -0 "$tunnel_pid" >/dev/null 2>&1 || die "autossh exited before becoming persistent"
  temporary_pid="$pid_file.$$"
  printf '%s\n' "$tunnel_pid" > "$temporary_pid"
  chmod 600 "$temporary_pid"
  mv "$temporary_pid" "$pid_file"
  echo "start-tunnel: started (pid $tunnel_pid)"
}

stop_tunnel() {
  pid="$(read_pid 2>/dev/null)" || {
    echo "start-tunnel: already stopped"
    return 0
  }
  is_managed_process "$pid" || die "refusing to stop unmanaged pid $pid"
  kill "$pid"
  rm -f "$pid_file"
  echo "start-tunnel: stopped pid $pid"
}

first_argument="${1:-}"
case "$#:$first_argument" in
  0:)
    usage
    ;;
  1:--status)
    status
    ;;
  2:--apply)
    [ "$2" = "--confirm-production" ] || die "--apply requires --confirm-production"
    apply_tunnel
    ;;
  2:--stop)
    [ "$2" = "--confirm-production" ] || die "--stop requires --confirm-production"
    stop_tunnel
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
