#!/usr/bin/env bash
set -euo pipefail

repository_root="$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "$repository_root"

compose_file="$repository_root/deploy/compose.production.yml"
project="tashan-orgspace-prod-test-$$"
temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/orgspace-production-stack.XXXXXX")"
private_key_file="$temporary_root/jwt-private.pem"
public_key_file="$temporary_root/jwt-public.pem"
mkdir -p "$repository_root/.local-data"
public_downloads="$(mktemp -d "$repository_root/.local-data/orgspace-public-downloads.XXXXXX")"

cleanup() {
  cleanup_arguments=(down --remove-orphans --volumes)
  docker compose -f "$compose_file" -p "$project" "${cleanup_arguments[@]}" >/dev/null 2>&1 || true
  rm -rf "$temporary_root"
  rm -rf "$public_downloads"
  rmdir "$repository_root/.local-data" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

if lsof -nP -iTCP:44110 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "production-stack: refusing because loopback port 44110 is already in use" >&2
  exit 1
fi

node --input-type=module -e '
  import { generateKeyPairSync } from "node:crypto";
  import { writeFileSync } from "node:fs";
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  writeFileSync(process.argv[1], privateKey.export({ type: "pkcs8", format: "pem" }));
  writeFileSync(process.argv[2], publicKey.export({ type: "spki", format: "pem" }));
' "$private_key_file" "$public_key_file"

export ORGSPACE_POSTGRES_PASSWORD="production-stack-postgres-$$"
export MINIO_ROOT_USER="productionstackroot$$"
export MINIO_ROOT_PASSWORD="production-stack-minio-root-password-$$"
export S3_ACCESS_KEY_ID="productionstackapp$$"
export S3_SECRET_ACCESS_KEY="production-stack-s3-app-secret-$$"
export PARTNER_FIELD_ACTIVE_KEY_VERSION="1"
export PARTNER_FIELD_KEYS="$(node -e 'process.stdout.write(JSON.stringify({1:Buffer.alloc(32,1).toString("base64url")}))')"
export PARTNER_BLIND_INDEX_KEY="$(node -e 'process.stdout.write(Buffer.alloc(32,2).toString("base64url"))')"
export SERVICE_VERSION="$(node -p "JSON.parse(require('node:fs').readFileSync('release/cli-release.json')).version")"
export JWT_ACTIVE_KEY_ID="production-stack-key-1"
export JWT_PRIVATE_KEY="$(cat "$private_key_file")"
export JWT_PUBLIC_KEY="$(cat "$public_key_file")"
export PHONE_CODE_PEPPER="production-stack-phone-code-pepper-value"
export ALIYUN_SMS_ACCESS_KEY_ID="production-stack-access-key-id"
export ALIYUN_SMS_ACCESS_KEY_SECRET="production-stack-access-key-secret"
export ALIYUN_SMS_SIGN_NAME="production-stack-sign"
export ALIYUN_SMS_TEMPLATE_CODE="SMS_PRODUCTION_STACK"
export ALIYUN_SMS_TEMPLATE_PARAM_KEY="code"
export ALIYUN_SMS_ENDPOINT="dysmsapi.aliyuncs.com"
export ALIYUN_SMS_REGION_ID="cn-hangzhou"
export ORGSPACE_PUBLIC_DOWNLOADS_DIR="$public_downloads"

mkdir -p "$public_downloads/v$SERVICE_VERSION"
printf '%s\n' '#!/bin/sh' 'echo fixture installer' >"$public_downloads/install-skill.sh"
printf '%s\n' 'fixture-checksum  fixture-asset' >"$public_downloads/v$SERVICE_VERSION/SHA256SUMS"
chmod 755 "$public_downloads" "$public_downloads/v$SERVICE_VERSION"
chmod 644 "$public_downloads/install-skill.sh" "$public_downloads/v$SERVICE_VERSION/SHA256SUMS"

docker compose -f "$compose_file" -p "$project" config --quiet
docker compose -f "$compose_file" -p "$project" up -d --build --wait

if [ "${ORGSPACE_TEST_DIAGNOSTICS:-0}" = "1" ]; then
  printf 'host public downloads: %s\n' "$public_downloads"
  find "$public_downloads" -maxdepth 2 -type f -print
  gateway_container="$(docker compose -f "$compose_file" -p "$project" ps -q gateway)"
  docker inspect "$gateway_container" --format '{{json .Mounts}}'
  docker compose -f "$compose_file" -p "$project" exec -T gateway \
    sh -c 'id; mount | grep downloads || true; ls -ld /usr/share/nginx/html/downloads/orgspace; find /usr/share/nginx/html/downloads/orgspace -maxdepth 2 -type f -print'
fi

gateway_ready=0
for readiness_attempt in $(seq 1 200); do
  if curl --fail --silent --show-error --max-time 1 \
    http://127.0.0.1:44110/v1/health >/dev/null 2>&1; then
    gateway_ready=1
    break
  fi
  sleep 0.1
done
if [ "$gateway_ready" != "1" ]; then
  docker compose -f "$compose_file" -p "$project" ps >&2
  docker compose -f "$compose_file" -p "$project" logs --no-color gateway >&2
  echo "production-stack: loopback gateway did not become reachable" >&2
  exit 1
fi

for private_service in postgres redis minio api; do
  published="$(docker compose -f "$compose_file" -p "$project" port "$private_service" 2>/dev/null || true)"
  if [ -n "$published" ]; then
    echo "production-stack: $private_service unexpectedly published $published" >&2
    exit 1
  fi
done

PRODUCTION_STACK_URL="http://127.0.0.1:44110" \
  PRODUCTION_STACK_VERSION="$SERVICE_VERSION" \
  pnpm exec vitest run tests/production-stack/stack.test.ts

docker compose -f "$compose_file" -p "$project" restart minio
minio_ready=0
for readiness_attempt in $(seq 1 200); do
  if curl --fail --silent --show-error --max-time 1 \
    -H 'Host: files.orgspace.tashan.chat' \
    http://127.0.0.1:44110/minio/health/live >/dev/null 2>&1; then
    minio_ready=1
    break
  fi
  sleep 0.1
done
if [ "$minio_ready" != "1" ]; then
  docker compose -f "$compose_file" -p "$project" ps >&2
  docker compose -f "$compose_file" -p "$project" logs --no-color minio gateway >&2
  echo "production-stack: MinIO did not recover through the file gateway" >&2
  exit 1
fi

PRODUCTION_STACK_URL="http://127.0.0.1:44110" \
  PRODUCTION_STACK_VERSION="$SERVICE_VERSION" \
  pnpm exec vitest run tests/production-stack/stack.test.ts

echo "production-stack: PASS ($project)"
