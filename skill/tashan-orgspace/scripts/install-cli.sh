#!/bin/sh
set -eu

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
release_file="$script_dir/../release.json"

usage() {
  cat <<'EOF'
Usage:
  install-cli.sh --check
  install-cli.sh --install [--version <semver>]

Installs torg into the current user's data and bin directories without sudo.
With no arguments, this command only prints help.
EOF
}

fail() {
  printf 'install-cli: %s\n' "$1" >&2
  exit 1
}

json_string() {
  key=$1
  value=$(sed -n "s/^[[:space:]]*\"$key\": \"\([^\"]*\)\",\{0,1\}$/\1/p" "$release_file" | head -n 1)
  [ -n "$value" ] || fail "missing $key in release metadata"
  printf '%s\n' "$value"
}

is_semver() {
  printf '%s\n' "$1" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$'
}

detect_platform() {
  case "$(uname -s)" in
    Darwin) operating_system=darwin ;;
    Linux) operating_system=linux ;;
    *) fail "unsupported operating system: $(uname -s)" ;;
  esac
  case "$(uname -m)" in
    arm64 | aarch64) architecture=arm64 ;;
    x86_64 | amd64) architecture=x64 ;;
    *) fail "unsupported architecture: $(uname -m)" ;;
  esac
  printf '%s-%s\n' "$operating_system" "$architecture"
}

hash_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    fail "neither shasum nor sha256sum is available"
  fi
}

replace_symlink() {
  link_value=$1
  link_path=$2
  next_link="$link_path.next-$$"
  ln -s "$link_value" "$next_link"
  case "$(uname -s)" in
    Linux) mv -Tf "$next_link" "$link_path" ;;
    Darwin) mv -fh "$next_link" "$link_path" ;;
    *) rm -f -- "$next_link"; fail "unsupported operating system for activation" ;;
  esac
}

mode=help
version=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --check | --install)
      [ "$mode" = help ] || fail "choose exactly one mode"
      mode=${1#--}
      shift
      ;;
    --version)
      [ "$#" -ge 2 ] || fail "--version requires a value"
      version=$2
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) fail "unknown argument: $1" ;;
  esac
done

if [ "$mode" = help ]; then
  [ -z "$version" ] || fail "--version requires --install"
  usage
  exit 0
fi
if [ "$mode" = check ] && [ -n "$version" ]; then
  fail "--version is only valid with --install"
fi

pinned_version=$(json_string version)
repository=$(json_string repository)
version=${version:-$pinned_version}
is_semver "$version" || fail "version must be semver"

if [ "${TORG_INSTALL_TESTING:-}" = "1" ]; then
  platform=${TORG_INSTALL_PLATFORM:-$(detect_platform)}
  release_base_url=${TORG_RELEASE_BASE_URL:-"https://github.com/$repository/releases/download/v$version"}
  curl_options="-fL"
else
  platform=$(detect_platform)
  release_base_url="https://github.com/$repository/releases/download/v$version"
  curl_options="-fL --proto =https --tlsv1.2"
fi

case "$platform" in
  darwin-arm64 | darwin-x64 | linux-x64) ;;
  *) fail "unsupported platform: $platform" ;;
esac

data_home=${XDG_DATA_HOME:-"$HOME/.local/share"}
install_root="$data_home/torg"
bin_directory=${TORG_BIN_DIR:-"$HOME/.local/bin"}
case "$install_root:$bin_directory" in
  /*:/*) ;;
  *) fail "install and bin directories must be absolute paths" ;;
esac
[ "$install_root" != "/torg" ] || fail "refusing unsafe install root"

target="$bin_directory/torg"
managed_target="$install_root/current/bin/torg"
if [ -e "$target" ] || [ -L "$target" ]; then
  if [ ! -L "$target" ] || [ "$(readlink "$target")" != "$managed_target" ]; then
    fail "refusing to replace unmanaged torg at $target"
  fi
fi

if [ "$mode" = check ]; then
  [ -L "$target" ] || fail "torg is not installed by this installer"
  installed_version=$($target --version 2>/dev/null) || fail "installed torg failed its version check"
  printf 'torg %s is installed at %s\n' "$installed_version" "$target"
  exit 0
fi

if [ -L "$target" ]; then
  installed_version=$($target --version 2>/dev/null || true)
  if [ "$installed_version" = "$version" ]; then
    printf 'torg %s is already installed at %s\n' "$version" "$target"
    exit 0
  fi
fi

asset="torg-v$version-$platform.tar.gz"
top_level=${asset%.tar.gz}
temporary_root=""
staging_root=""
cleanup() {
  if [ -n "$temporary_root" ] && [ -d "$temporary_root" ]; then
    rm -rf -- "$temporary_root"
  fi
  if [ -n "$staging_root" ] && [ -d "$staging_root" ]; then
    rm -rf -- "$staging_root"
  fi
}
trap cleanup EXIT HUP INT TERM

temporary_root=$(mktemp -d "${TMPDIR:-/tmp}/torg-install.XXXXXX")
archive="$temporary_root/$asset"
checksums="$temporary_root/SHA256SUMS"

# shellcheck disable=SC2086
curl $curl_options -o "$checksums" "$release_base_url/SHA256SUMS" >/dev/null 2>&1 || fail "failed to download SHA256SUMS"
# shellcheck disable=SC2086
curl $curl_options -o "$archive" "$release_base_url/$asset" >/dev/null 2>&1 || fail "failed to download $asset"

expected_hash=$(awk -v file="$asset" '$2 == file { count += 1; hash = $1 } END { if (count == 1) print hash; else exit 1 }' "$checksums") || fail "checksum entry not found for $asset"
printf '%s\n' "$expected_hash" | grep -Eq '^[0-9a-f]{64}$' || fail "invalid checksum for $asset"
actual_hash=$(hash_file "$archive")
[ "$actual_hash" = "$expected_hash" ] || fail "checksum verification failed for $asset"

if ! tar -tvzf "$archive" | awk '$1 !~ /^[-d]/ { bad = 1 } END { exit bad }'; then
  fail "archive links are not allowed"
fi

actual_entries="$temporary_root/actual-entries"
expected_entries="$temporary_root/expected-entries"
tar -tzf "$archive" | LC_ALL=C sort >"$actual_entries"
cat >"$expected_entries" <<EOF
$top_level/
$top_level/THIRD_PARTY_NOTICES/
$top_level/THIRD_PARTY_NOTICES/Node-LICENSE
$top_level/VERSION
$top_level/bin/
$top_level/bin/torg
$top_level/lib/
$top_level/lib/torg.mjs
$top_level/runtime/
$top_level/runtime/node
EOF
LC_ALL=C sort -o "$expected_entries" "$expected_entries"
cmp -s "$actual_entries" "$expected_entries" || fail "invalid archive layout"

mkdir -p "$install_root/versions" "$bin_directory"
version_directory="$install_root/versions/$version"
[ ! -e "$version_directory" ] || fail "version directory already exists but is not active: $version"
staging_root="$install_root/.staging-$version-$$"
[ ! -e "$staging_root" ] || fail "staging directory already exists"
mkdir "$staging_root"
tar -xzf "$archive" -C "$staging_root"
candidate="$staging_root/$top_level"
[ -x "$candidate/bin/torg" ] || fail "invalid archive layout"
[ -x "$candidate/runtime/node" ] || fail "invalid archive layout"
[ "$(cat "$candidate/VERSION")" = "$version" ] || fail "archive version mismatch"
candidate_version=$($candidate/bin/torg --version 2>/dev/null || true)
[ "$candidate_version" = "$version" ] || fail "installed CLI smoke test failed"

mv "$candidate" "$version_directory"
rm -rf -- "$staging_root"
staging_root=""

old_current=""
if [ -L "$install_root/current" ]; then
  old_current=$(readlink "$install_root/current")
elif [ -e "$install_root/current" ]; then
  fail "refusing to replace unmanaged current path"
fi
replace_symlink "versions/$version" "$install_root/current"

if [ ! -L "$target" ]; then
  next_target="$bin_directory/.torg-$$"
  ln -s "$managed_target" "$next_target"
  mv "$next_target" "$target"
fi

active_version=$($target --version 2>&1 || true)
if [ "$active_version" != "$version" ]; then
  if [ -n "$old_current" ]; then
    replace_symlink "$old_current" "$install_root/current"
  else
    rm -f -- "$install_root/current" "$target"
  fi
  fail "installed CLI smoke test failed after activation: $active_version"
fi

printf 'installed torg %s at %s\n' "$version" "$target"
