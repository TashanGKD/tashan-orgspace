#!/bin/sh
set -eu

pinned_version="1.0.0"
official_distribution_base="https://orgspace.tashan.chat/downloads/orgspace"
github_repository="TashanGKD/tashan-orgspace"
asset="tashan-orgspace-skill-v$pinned_version.tar.gz"

usage() {
  cat <<'EOF'
Usage:
  install-skill.sh --check
  install-skill.sh --install

Installs the pinned Tashan OrgSpace Skill into the current user's Codex
Skill directory. With no arguments, this command only prints help.
EOF
}

fail() {
  printf 'install-skill: %s\n' "$1" >&2
  exit 1
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

mode=help
case "$#:${1:-}" in
  0:) ;;
  1:--check) mode=check ;;
  1:--install) mode=install ;;
  1:-h | 1:--help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

if [ "$mode" = help ]; then
  usage
  exit 0
fi

codex_home=${CODEX_HOME:-"$HOME/.codex"}
case "$codex_home" in
  /*) ;;
  *) fail "CODEX_HOME must be an absolute path" ;;
esac
[ "$codex_home" != "/" ] || fail "refusing unsafe CODEX_HOME"
skills_root="$codex_home/skills"
target="$skills_root/tashan-orgspace"
managed_marker="$target/.orgspace-installer-managed"

if [ "$mode" = check ]; then
  [ -d "$target" ] && [ ! -L "$target" ] && [ -f "$managed_marker" ] ||
    fail "tashan-orgspace is not installed by this installer"
  installed_version=$(sed -n '1p' "$managed_marker")
  printf 'tashan-orgspace %s is installed\n' "$installed_version"
  exit 0
fi

if [ -e "$target" ] || [ -L "$target" ]; then
  [ -d "$target" ] && [ ! -L "$target" ] && [ -f "$managed_marker" ] ||
    fail "refusing to replace unmanaged Skill at $target"
  installed_version=$(sed -n '1p' "$managed_marker")
  if [ "$installed_version" = "$pinned_version" ]; then
    printf 'tashan-orgspace %s is already installed\n' "$pinned_version"
    exit 0
  fi
fi

if [ "${ORGSPACE_SKILL_INSTALL_TESTING:-}" = "1" ]; then
  release_base_url=${ORGSPACE_SKILL_RELEASE_BASE_URL:-"$official_distribution_base/v$pinned_version"}
  curl_options="-fL --connect-timeout 2 --max-time 10"
else
  release_base_url="$official_distribution_base/v$pinned_version"
  curl_options="-fL --proto =https --tlsv1.2 --connect-timeout 10 --max-time 120 --retry 2 --retry-all-errors"
fi

temporary_root=""
backup=""
cleanup() {
  if [ -n "$temporary_root" ] && [ -d "$temporary_root" ]; then
    rm -rf -- "$temporary_root"
  fi
}
trap cleanup EXIT HUP INT TERM

temporary_root=$(mktemp -d "${TMPDIR:-/tmp}/orgspace-skill-install.XXXXXX")
archive="$temporary_root/$asset"
checksums="$temporary_root/SHA256SUMS"

# shellcheck disable=SC2086
if ! curl $curl_options -o "$checksums" "$release_base_url/SHA256SUMS" >/dev/null 2>&1; then
  fail "official download failed; use Codex skill-installer with $github_repository at tag v$pinned_version"
fi
# shellcheck disable=SC2086
if ! curl $curl_options -o "$archive" "$release_base_url/$asset" >/dev/null 2>&1; then
  fail "official download failed; use Codex skill-installer with $github_repository at tag v$pinned_version"
fi

checksum_count=$(awk -v file="$asset" '$2 == file { count += 1 } END { print count + 0 }' "$checksums")
[ "$checksum_count" = "1" ] || fail "checksum entry must appear exactly once for $asset"
expected_hash=$(awk -v file="$asset" '$2 == file { print $1 }' "$checksums")
printf '%s\n' "$expected_hash" | grep -Eq '^[0-9a-f]{64}$' || fail "invalid checksum for $asset"
actual_hash=$(hash_file "$archive")
[ "$actual_hash" = "$expected_hash" ] || fail "checksum verification failed for $asset"

if ! tar -tvzf "$archive" | awk '$1 !~ /^[-d]/ { bad = 1 } END { exit bad }'; then
  fail "archive links are not allowed"
fi

actual_entries="$temporary_root/actual-entries"
expected_entries="$temporary_root/expected-entries"
tar -tzf "$archive" | LC_ALL=C sort >"$actual_entries"
cat >"$expected_entries" <<'EOF'
tashan-orgspace/
tashan-orgspace/SKILL.md
tashan-orgspace/agents/
tashan-orgspace/agents/openai.yaml
tashan-orgspace/capability-references.json
tashan-orgspace/references/
tashan-orgspace/references/authentication.md
tashan-orgspace/references/chat.md
tashan-orgspace/references/files.md
tashan-orgspace/references/my-work.md
tashan-orgspace/references/notifications.md
tashan-orgspace/references/okr.md
tashan-orgspace/references/partners.md
tashan-orgspace/references/safety.md
tashan-orgspace/references/search.md
tashan-orgspace/references/work.md
tashan-orgspace/release.json
tashan-orgspace/scripts/
tashan-orgspace/scripts/install-cli.sh
EOF
LC_ALL=C sort -o "$expected_entries" "$expected_entries"
cmp -s "$actual_entries" "$expected_entries" || fail "invalid Skill archive layout"

staging="$temporary_root/staging"
mkdir "$staging"
tar -xzf "$archive" -C "$staging"
candidate="$staging/tashan-orgspace"
[ -f "$candidate/SKILL.md" ] || fail "invalid Skill archive layout"
[ -f "$candidate/release.json" ] || fail "invalid Skill archive layout"
[ -x "$candidate/scripts/install-cli.sh" ] || fail "invalid Skill archive layout"
printf '%s\n' "$pinned_version" >"$candidate/.orgspace-installer-managed"

mkdir -p "$skills_root"
if [ -e "$target" ]; then
  backup="$skills_root/.tashan-orgspace.previous-$$"
  [ ! -e "$backup" ] || fail "refusing existing backup path"
  mv "$target" "$backup"
fi
if ! mv "$candidate" "$target"; then
  if [ -n "$backup" ] && [ -d "$backup" ]; then
    mv "$backup" "$target"
  fi
  fail "failed to activate Skill"
fi
if [ -n "$backup" ] && [ -d "$backup" ]; then
  rm -rf -- "$backup"
fi

printf 'installed tashan-orgspace %s; restart Codex to load the Skill\n' "$pinned_version"
