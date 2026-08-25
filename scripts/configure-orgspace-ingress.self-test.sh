#!/usr/bin/env bash
set -euo pipefail

repository_root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
configure="$repository_root/scripts/configure-orgspace-ingress.sh"
tunnel="$repository_root/deploy/start-tunnel.sh"
temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/orgspace-ingress-test.XXXXXX")"
fake_bin="$temporary_root/bin"
transport_log="$temporary_root/transport.log"
state_dir="$temporary_root/tunnel-state"
mkdir -p "$fake_bin" "$state_dir"

cleanup() {
  if [ -f "$state_dir/autossh.pid" ]; then
    tunnel_pid="$(cat "$state_dir/autossh.pid")"
    kill "$tunnel_pid" >/dev/null 2>&1 || true
  fi
  rm -rf "$temporary_root"
}
trap cleanup EXIT INT TERM

cat > "$fake_bin/git" <<'EOF'
#!/usr/bin/env bash
set -eu
case "$*" in
  *"diff --quiet"*|*"diff --cached --quiet"*) exit 0 ;;
  *) exit 0 ;;
esac
EOF

cat > "$fake_bin/ssh" <<'EOF'
#!/usr/bin/env bash
set -eu
printf 'ssh %s\n' "$*" >> "${ORGSPACE_TEST_TRANSPORT_LOG:?}"
if [ "${FAKE_NGINX_TEST_FAIL:-0}" = "1" ]; then
  case "$*" in *"nginx -t"*) exit 1 ;; esac
fi
case "$*" in
  *"test -e /etc/nginx/sites-available/orgspace.tashan.chat"*) echo absent ;;
esac
EOF

cat > "$fake_bin/scp" <<'EOF'
#!/usr/bin/env bash
set -eu
printf 'scp %s\n' "$*" >> "${ORGSPACE_TEST_TRANSPORT_LOG:?}"
EOF

cat > "$fake_bin/curl" <<'EOF'
#!/usr/bin/env bash
set -eu
printf 'curl %s\n' "$*" >> "${ORGSPACE_TEST_TRANSPORT_LOG:?}"
printf '%s\n' '{"status":"ok","version":"0.1.0-alpha.2"}'
EOF

cat > "$fake_bin/autossh" <<'EOF'
#!/usr/bin/env bash
set -eu
printf 'autossh %s\n' "$*" >> "${ORGSPACE_TEST_TRANSPORT_LOG:?}"
while :; do /bin/sleep 60; done
EOF

chmod +x "$fake_bin/git" "$fake_bin/ssh" "$fake_bin/scp" "$fake_bin/curl" "$fake_bin/autossh"

run_configure() {
  PATH="$fake_bin:$PATH" ORGSPACE_INGRESS_TESTING=1 \
    ORGSPACE_TEST_TRANSPORT_LOG="$transport_log" "$configure" "$@"
}

run_tunnel() {
  PATH="$fake_bin:$PATH" ORGSPACE_TUNNEL_TESTING=1 \
    ORGSPACE_TUNNEL_STATE_DIR="$state_dir" ORGSPACE_TEST_TRANSPORT_LOG="$transport_log" \
    "$tunnel" "$@"
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
    *) printf 'missing %s\n%s\n' "$expected" "$output" >&2; exit 1 ;;
  esac
}

wait_for_log() {
  expected="$1"
  wait_attempt=0
  while [ "$wait_attempt" -lt 100 ]; do
    grep -q -- "$expected" "$transport_log" && return 0
    wait_attempt=$((wait_attempt + 1))
    sleep 0.02
  done
  echo "timed out waiting for transport log: $expected" >&2
  if [ -f "$state_dir/autossh.log" ]; then
    sed -n '1,80p' "$state_dir/autossh.log" >&2
  fi
  if [ -f "$state_dir/autossh.pid" ]; then
    diagnostic_pid="$(cat "$state_dir/autossh.pid")"
    ps -p "$diagnostic_pid" -o pid=,ppid=,state=,command= >&2 || true
  fi
  return 1
}

: > "$transport_log"
run_tunnel >/dev/null
run_configure >/dev/null
test ! -s "$transport_log"

: > "$transport_log"
run_tunnel --apply --confirm-production >/dev/null
wait_for_log "autossh -M 0 -N"
wait_for_log "-R 127.0.0.1:14010:127.0.0.1:44110"
if grep -Eq -- '-R (0\.0\.0\.0|\[::\]|\*:)' "$transport_log"; then
  echo "tunnel exposed a non-loopback reverse bind" >&2
  exit 1
fi

valid_template="$repository_root/deploy/nginx/ecs-orgspace.conf"
for mutation in wrong-host http-only wrong-upstream; do
  candidate="$temporary_root/$mutation.conf"
  case "$mutation" in
    wrong-host) sed 's/server_name orgspace\.tashan\.chat/server_name wrong.tashan.chat/' "$valid_template" > "$candidate" ;;
    http-only) sed '/listen 443 ssl http2;/d' "$valid_template" > "$candidate" ;;
    wrong-upstream) sed 's#127\.0\.0\.1:14010#127.0.0.1:14011#g' "$valid_template" > "$candidate" ;;
  esac
  : > "$transport_log"
  expect_failure "ingress template violates the production contract" env \
    PATH="$fake_bin:$PATH" ORGSPACE_INGRESS_TESTING=1 \
    ORGSPACE_TEST_TRANSPORT_LOG="$transport_log" ORGSPACE_INGRESS_TEMPLATE="$candidate" \
    "$configure" --preflight
  test ! -s "$transport_log"
done

: > "$transport_log"
run_configure --apply --confirm-production >/dev/null
grep -q 'scp .*orgspace.tashan.chat.next' "$transport_log"
grep -q "sites-available/orgspace.tashan.chat" "$transport_log"
if grep '^ssh ' "$transport_log" | grep -qv -- '-o BatchMode=yes -o ConnectTimeout=10'; then
  echo "ingress SSH call is missing fail-fast connection options" >&2
  exit 1
fi
grep '^scp ' "$transport_log" | grep -q -- '-o BatchMode=yes -o ConnectTimeout=10'
if grep -Eq 'sites-(available|enabled)/(ask\.tashan\.chat|org\.tashan\.chat|panshi[^/]*)' "$transport_log"; then
  echo "ingress installer touched another vhost" >&2
  exit 1
fi

: > "$transport_log"
expect_failure "ECS nginx validation failed; prior OrgSpace vhost restored" env \
  PATH="$fake_bin:$PATH" ORGSPACE_INGRESS_TESTING=1 \
  ORGSPACE_TEST_TRANSPORT_LOG="$transport_log" FAKE_NGINX_TEST_FAIL=1 \
  "$configure" --apply --confirm-production
grep -q 'restore-orgspace-vhost' "$transport_log"

echo "configure-orgspace-ingress.self-test: PASS"
