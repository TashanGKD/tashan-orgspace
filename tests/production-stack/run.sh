#!/usr/bin/env bash
set -euo pipefail

repository_root="$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "$repository_root"

compose_file="$repository_root/deploy/compose.production.yml"
project="tashan-orgspace-prod-test-$$"
temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/orgspace-production-stack.XXXXXX")"
private_key_file="$temporary_root/jwt-private.pem"
public_key_file="$temporary_root/jwt-public.pem"

cleanup() {
  cleanup_arguments=(down --remove-orphans)
  if [ "${ORGSPACE_TEST_CLEANUP_VOLUMES:-0}" = "1" ]; then
    cleanup_arguments+=(--volumes)
  fi
  docker compose -f "$compose_file" -p "$project" "${cleanup_arguments[@]}" >/dev/null 2>&1 || true
  rm -rf "$temporary_root"
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

docker compose -f "$compose_file" -p "$project" config --quiet
docker compose -f "$compose_file" -p "$project" up -d --build --wait

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

for private_service in postgres redis api; do
  published="$(docker compose -f "$compose_file" -p "$project" port "$private_service" 2>/dev/null || true)"
  if [ -n "$published" ]; then
    echo "production-stack: $private_service unexpectedly published $published" >&2
    exit 1
  fi
done

PRODUCTION_STACK_URL="http://127.0.0.1:44110" \
  PRODUCTION_STACK_VERSION="$SERVICE_VERSION" \
  pnpm exec vitest run tests/production-stack/stack.test.ts

echo "production-stack: PASS ($project)"
if [ "${ORGSPACE_TEST_CLEANUP_VOLUMES:-0}" != "1" ]; then
  echo "production-stack: named volumes preserved; set ORGSPACE_TEST_CLEANUP_VOLUMES=1 for isolated test-volume cleanup"
fi
