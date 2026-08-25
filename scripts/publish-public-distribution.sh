#!/usr/bin/env bash
set -euo pipefail

repository_root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
release_file="$repository_root/release/cli-release.json"
contract_file="$repository_root/deploy/production-contract.json"
stable_installer="$repository_root/distribution/install-skill.sh"
ssh_options=(-o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=2)

die() {
  echo "publish-public-distribution: $*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage:
  scripts/publish-public-distribution.sh
  scripts/publish-public-distribution.sh --preflight --source-dir <release-directory>
  scripts/publish-public-distribution.sh --apply --confirm-production --source-dir <release-directory>

No arguments prints a bounded DRY-RUN plan. It does not use SSH, upload files,
create directories, or change the stable installer.
EOF
}

mode=dry-run
source_dir=""
case "$#:${1:-}" in
  0:) ;;
  3:--preflight)
    [ "$2" = "--source-dir" ] || die "--preflight requires --source-dir"
    mode=preflight
    source_dir=$3
    ;;
  4:--apply)
    [ "$2" = "--confirm-production" ] || die "--apply requires --confirm-production"
    [ "$3" = "--source-dir" ] || die "--apply requires --source-dir"
    mode=apply
    source_dir=$4
    ;;
  3:--apply) die "--apply requires --confirm-production" ;;
  *)
    usage >&2
    exit 2
    ;;
esac

metadata="$(node -e '
  const fs = require("node:fs");
  const release = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const contract = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const expected = {
    distributionBaseUrl: "https://orgspace.tashan.chat/downloads/orgspace",
    repository: "TashanGKD/tashan-orgspace",
    remoteRoot: "/home/aup/tashan-orgspace",
    aupHostAlias: "aup-server",
  };
  for (const [key, value] of Object.entries(expected)) {
    const actual = key in release ? release[key] : contract[key];
    if (actual !== value) process.exit(42);
  }
  const assets = [release.skillAsset, ...release.platforms.map((entry) => entry.asset)];
  process.stdout.write([release.version, contract.aupHostAlias, contract.remoteRoot, ...assets].join("\t"));
' "$release_file" "$contract_file")" || die "release or production contract is outside the OrgSpace boundary"

IFS=$'\t' read -r version aup_host remote_root skill_asset cli_arm cli_x64 cli_linux <<<"$metadata"
case "$version" in
  "" | *[!0-9A-Za-z.-]*) die "release version must be semver" ;;
esac
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$ ]] ||
  die "release version must be semver"
[ "$remote_root" = "/home/aup/tashan-orgspace" ] || die "remote root is outside OrgSpace"
public_root="$remote_root/shared/public-downloads"
remote_version="$public_root/v$version"

if [ "$mode" = dry-run ]; then
  cat <<EOF
OrgSpace public distribution DRY-RUN
  version: $version
  source: <explicit --source-dir required>
  destination: $aup_host:$remote_version
  stable installer: $aup_host:$public_root/install-skill.sh

Run --preflight --source-dir <dir> for read-only checks.
Run --apply --confirm-production --source-dir <dir> to publish immutably.
EOF
  exit 0
fi

case "$source_dir" in
  /*) ;;
  *) die "source directory must be an absolute path" ;;
esac
[ -d "$source_dir" ] && [ ! -L "$source_dir" ] || die "source directory must be a real directory"
[ -f "$stable_installer" ] && [ ! -L "$stable_installer" ] || die "stable Skill installer is missing"

git -C "$repository_root" diff --quiet -- . || die "tracked worktree must be clean"
git -C "$repository_root" diff --cached --quiet -- . || die "tracked worktree must be clean"
tag="$(git -C "$repository_root" describe --exact-match --tags HEAD 2>/dev/null || true)"
[ "$tag" = "v$version" ] || die "exact tag must be v$version"

assets=("$skill_asset" "$cli_arm" "$cli_x64" "$cli_linux")
expected_files=("SHA256SUMS" "${assets[@]}")
source_files=()
for file in "${expected_files[@]}"; do source_files+=("$source_dir/$file"); done
actual_files=()
while IFS= read -r file; do actual_files+=("${file##*/}"); done < <(
  find "$source_dir" -mindepth 1 -maxdepth 1 -type f -print | LC_ALL=C sort
)
if [ "$(printf '%s\n' "${actual_files[@]}" | LC_ALL=C sort)" != "$(printf '%s\n' "${expected_files[@]}" | LC_ALL=C sort)" ]; then
  die "release directory must contain exactly SHA256SUMS and four release archives"
fi
[ -z "$(find "$source_dir" -mindepth 1 -maxdepth 1 -type l -print -quit)" ] ||
  die "release directory must not contain symlinks"

for asset in "${assets[@]}"; do
  count="$(awk -v file="$asset" '$2 == file { count += 1 } END { print count + 0 }' "$source_dir/SHA256SUMS")"
  [ "$count" = "1" ] || die "checksum entry must appear exactly once for $asset"
done
[ "$(awk 'NF { count += 1 } END { print count + 0 }' "$source_dir/SHA256SUMS")" = "4" ] ||
  die "SHA256SUMS must contain exactly four entries"
(cd "$source_dir" && shasum -a 256 -c SHA256SUMS >/dev/null) || die "release checksum validation failed"

for asset in "${assets[@]}"; do
  if ! tar -tvzf "$source_dir/$asset" | awk '$1 !~ /^[-d]/ { bad = 1 } END { exit bad }'; then
    die "release archives must not contain links: $asset"
  fi
  expected_root="${asset%.tar.gz}"
  [ "$asset" = "$skill_asset" ] && expected_root="tashan-orgspace"
  tar -tzf "$source_dir/$asset" | awk -v root="$expected_root/" '
    index($0, root) != 1 || $0 ~ /(^|\/)\.\.($|\/)/ { bad = 1 }
    END { exit bad }
  ' || die "release archive escaped its expected root: $asset"
done
grep -Fq "pinned_version=\"$version\"" "$stable_installer" ||
  die "stable Skill installer version does not match release"

ssh "${ssh_options[@]}" "$aup_host" \
  "set -eu; test -d '$public_root'; test ! -L '$public_root'; test ! -e '$remote_version'" ||
  die "remote version already exists or public download root is invalid"

if [ "$mode" = preflight ]; then
  echo "publish-public-distribution preflight: PASS ($aup_host $remote_version)"
  exit 0
fi

staging="$public_root/.staging/v$version-$$"
stable_staging="$public_root/.install-skill.sh-$$"
remote_staging_created=0
cleanup_remote() {
  if [ "$remote_staging_created" = "1" ]; then
    ssh "${ssh_options[@]}" "$aup_host" \
      "rm -rf '$staging'; rm -f '$stable_staging'" >/dev/null 2>&1 || true
  fi
}
trap cleanup_remote EXIT INT TERM

ssh "${ssh_options[@]}" "$aup_host" \
  "set -eu; mkdir -p '$public_root/.staging'; test ! -e '$staging'; mkdir '$staging'"
remote_staging_created=1
rsync -a -e "ssh -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=2" \
  -- "${source_files[@]}" "$aup_host:$staging/"
rsync -a -e "ssh -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=2" \
  -- "$stable_installer" "$aup_host:$stable_staging"
ssh "${ssh_options[@]}" "$aup_host" "set -eu;
  cd '$staging';
  test \"\$(find . -mindepth 1 -maxdepth 1 -type f | wc -l)\" -eq 5;
  shasum -a 256 -c SHA256SUMS >/dev/null;
  chmod 755 '$staging'; chmod 644 '$staging'/* '$stable_staging';
  test ! -e '$remote_version'; mv '$staging' '$remote_version';
  mv -f '$stable_staging' '$public_root/install-skill.sh'"
remote_staging_created=0
trap - EXIT INT TERM

echo "publish-public-distribution: published v$version to $public_root"
