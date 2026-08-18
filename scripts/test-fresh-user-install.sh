#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/test-fresh-user-install.sh --local-build

Builds and installs the CLI into a disposable user environment. With no
arguments this command is read-only and only prints this help.
EOF
}

if [ "$#" -eq 0 ]; then
  usage
  exit 0
fi
if [ "$#" -ne 1 ] || [ "$1" != "--local-build" ]; then
  usage >&2
  exit 2
fi

repository_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
release_file="$repository_root/release/cli-release.json"
node_path=$(command -v node) || {
  printf '%s\n' "fresh-user: Node.js is required to build the local fixture" >&2
  exit 1
}

json_string() {
  key=$1
  sed -n "s/^[[:space:]]*\"$key\": \"\([^\"]*\)\",\{0,1\}$/\1/p" "$release_file" | head -n 1
}

version=$(json_string version)
case "$(uname -s):$(uname -m)" in
  Darwin:arm64) platform=darwin-arm64 ;;
  Darwin:x86_64) platform=darwin-x64 ;;
  Linux:x86_64 | Linux:amd64) platform=linux-x64 ;;
  *) printf '%s\n' "fresh-user: unsupported local test platform" >&2; exit 1 ;;
esac
asset="torg-v$version-$platform.tar.gz"

test_root=$(mktemp -d "${TMPDIR:-/tmp}/torg-fresh-user.XXXXXX")
server_pid=""
cleanup() {
  if [ -n "$server_pid" ]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf -- "$test_root"
}
trap cleanup EXIT HUP INT TERM

release_directory="$test_root/release"
fresh_home="$test_root/home"
fresh_codex_home="$test_root/codex"
safe_bin="$test_root/safe-bin"
mkdir -p "$release_directory" "$fresh_home" "$fresh_codex_home" "$safe_bin"

"$node_path" "$repository_root/scripts/build-cli-release.mjs" --output-dir "$release_directory" >/dev/null
cp "$release_directory/$asset.sha256" "$release_directory/SHA256SUMS"

if [ "${TORG_FRESH_TESTING:-}" = "1" ] && [ "${TORG_FRESH_TEST_CORRUPT:-}" = "1" ]; then
  printf 'corrupt\n' >>"$release_directory/$asset"
fi

key_file="$test_root/key.pem"
cert_file="$test_root/cert.pem"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -subj "/CN=127.0.0.1" -addext "subjectAltName=IP:127.0.0.1" \
  -keyout "$key_file" -out "$cert_file" >/dev/null 2>&1

port_file="$test_root/port"
"$node_path" "$repository_root/scripts/fixtures/fresh-user-server.mjs" \
  --release-dir "$release_directory" \
  --asset "$asset" \
  --port-file "$port_file" \
  --key "$key_file" \
  --cert "$cert_file" &
server_pid=$!

attempt=0
while [ ! -s "$port_file" ]; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 100 ] || {
    printf '%s\n' "fresh-user: fixture server did not start" >&2
    exit 1
  }
  sleep 0.05
done
port=$(cat "$port_file")
release_url="https://127.0.0.1:$port/releases/download/v$version"
installer="$repository_root/skill/tashan-orgspace/scripts/install-cli.sh"

set +e
install_output=$(HOME="$fresh_home" XDG_DATA_HOME="$fresh_home/.local/share" \
  TORG_BIN_DIR="$fresh_home/.local/bin" TORG_INSTALL_TESTING=1 \
  TORG_INSTALL_PLATFORM="$platform" TORG_RELEASE_BASE_URL="$release_url" \
  CURL_CA_BUNDLE="$cert_file" sh "$installer" --install 2>&1)
install_status=$?
set -e
if [ "${TORG_FRESH_TESTING:-}" = "1" ] && [ "${TORG_FRESH_TEST_CORRUPT:-}" = "1" ]; then
  printf '%s\n' "$install_output"
  [ "$install_status" -ne 0 ] || {
    printf '%s\n' "fresh-user: corrupt fixture was accepted" >&2
    exit 1
  }
  [ ! -e "$fresh_home/.local" ] || {
    printf '%s\n' "fresh-user: rejected install changed fresh HOME" >&2
    exit 1
  }
  printf '%s\n' "fresh-user: rejected install left fresh HOME unchanged"
  exit 1
fi
[ "$install_status" -eq 0 ] || {
  printf '%s\n' "$install_output" >&2
  exit "$install_status"
}

torg="$fresh_home/.local/bin/torg"
[ -x "$torg" ] || {
  printf '%s\n' "fresh-user: installed torg is not executable" >&2
  exit 1
}

second_output=$(HOME="$fresh_home" XDG_DATA_HOME="$fresh_home/.local/share" \
  TORG_BIN_DIR="$fresh_home/.local/bin" TORG_INSTALL_TESTING=1 \
  TORG_INSTALL_PLATFORM="$platform" TORG_RELEASE_BASE_URL="$release_url" \
  CURL_CA_BUNDLE="$cert_file" sh "$installer" --install)
printf '%s\n' "$second_output" | grep -Fq "is already installed" || {
  printf '%s\n' "fresh-user: reinstall was not idempotent" >&2
  exit 1
}

ln -s "$(command -v readlink)" "$safe_bin/readlink"
if PATH="$safe_bin" command -v node >/dev/null 2>&1; then
  printf '%s\n' "fresh-user: restricted PATH unexpectedly contains Node.js" >&2
  exit 1
fi

cli_version=$(HOME="$fresh_home" PATH="$safe_bin" "$torg" --version)
[ "$cli_version" = "$version" ] || {
  printf '%s\n' "fresh-user: wrong CLI version $cli_version" >&2
  exit 1
}
help_output=$(HOME="$fresh_home" PATH="$safe_bin" "$torg")
printf '%s\n' "$help_output" | grep -Fq "Tashan OrgSpace command line client" || {
  printf '%s\n' "fresh-user: no-argument help failed" >&2
  exit 1
}
capability_output=$(HOME="$fresh_home" PATH="$safe_bin" TORG_API_URL="https://127.0.0.1:$port" \
  NODE_EXTRA_CA_CERTS="$cert_file" "$torg" --invocation-source ai_via_cli --json capability list)
CAPABILITY_OUTPUT="$capability_output" "$node_path" -e '
  const value = JSON.parse(process.env.CAPABILITY_OUTPUT);
  if (!Array.isArray(value.items) || value.items.length !== 17) process.exit(1);
' || {
  printf '%s\n' "fresh-user: capability JSON smoke test failed" >&2
  exit 1
}

printf '%s\n' "test-fresh-user-install: PASS ($platform, torg $version, no system Node.js)"
