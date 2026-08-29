#!/usr/bin/env bash
set -eu

repository_root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$repository_root"

run_step() {
  label="$1"
  shift
  echo "+ $label"
  "$@"
}

run_step "pnpm check:toolchain" pnpm check:toolchain
run_step "pnpm format:check" pnpm format:check
run_step "pnpm lint" pnpm lint
run_step "pnpm typecheck" pnpm typecheck
run_step "pnpm test" pnpm test
run_step "pnpm exec vitest run tests/v1/journey-matrix.test.ts" pnpm exec vitest run tests/v1/journey-matrix.test.ts
run_step "pnpm test:distribution" pnpm test:distribution
run_step "node scripts/check-capability-coverage.mjs" node scripts/check-capability-coverage.mjs
run_step "node scripts/check-file-storage-contract.mjs" node scripts/check-file-storage-contract.mjs
run_step "node scripts/check-phone-auth-surface.mjs" node scripts/check-phone-auth-surface.mjs
run_step "node scripts/check-release-contract.mjs" node scripts/check-release-contract.mjs
run_step "node scripts/check-resource-surface-coverage.mjs" node scripts/check-resource-surface-coverage.mjs
run_step "node scripts/check-user-facing-copy.mjs" node scripts/check-user-facing-copy.mjs
run_step "node scripts/check-web-brand-contract.mjs" node scripts/check-web-brand-contract.mjs
run_step "node scripts/check-v1-product-contract.mjs" node scripts/check-v1-product-contract.mjs
run_step "node scripts/check-production-contract.mjs" node scripts/check-production-contract.mjs
run_step "node scripts/check-deferred-product-scope.mjs" node scripts/check-deferred-product-scope.mjs
run_step "node scripts/check-deferred-product-scope.self-test.mjs" node scripts/check-deferred-product-scope.self-test.mjs
run_step "node scripts/check-gate-self-tests.mjs" node scripts/check-gate-self-tests.mjs
run_step "node scripts/check-capability-coverage.self-test.mjs" node scripts/check-capability-coverage.self-test.mjs
run_step "node scripts/check-file-storage-contract.self-test.mjs" node scripts/check-file-storage-contract.self-test.mjs
run_step "node scripts/check-phone-auth-surface.self-test.mjs" node scripts/check-phone-auth-surface.self-test.mjs
run_step "node scripts/check-release-contract.self-test.mjs" node scripts/check-release-contract.self-test.mjs
run_step "node scripts/check-resource-surface-coverage.self-test.mjs" node scripts/check-resource-surface-coverage.self-test.mjs
run_step "node scripts/check-user-facing-copy.self-test.mjs" node scripts/check-user-facing-copy.self-test.mjs
run_step "node scripts/check-web-brand-contract.self-test.mjs" node scripts/check-web-brand-contract.self-test.mjs
run_step "node scripts/check-v1-product-contract.self-test.mjs" node scripts/check-v1-product-contract.self-test.mjs
run_step "node scripts/check-production-contract.self-test.mjs" node scripts/check-production-contract.self-test.mjs
run_step "node scripts/check-gate-self-tests.self-test.mjs" node scripts/check-gate-self-tests.self-test.mjs
run_step "node scripts/check-commit-evidence.self-test.mjs" node scripts/check-commit-evidence.self-test.mjs
run_step "bash scripts/deploy-orgspace.self-test.sh" bash scripts/deploy-orgspace.self-test.sh
run_step "bash scripts/publish-public-distribution.self-test.sh" bash scripts/publish-public-distribution.self-test.sh
run_step "bash scripts/smoke-public-distribution.self-test.sh" bash scripts/smoke-public-distribution.self-test.sh
run_step "bash scripts/configure-orgspace-ingress.self-test.sh" bash scripts/configure-orgspace-ingress.self-test.sh
run_step "bash scripts/smoke-production.self-test.sh" bash scripts/smoke-production.self-test.sh
run_step "node scripts/restore-orgspace-backup.self-test.mjs" node scripts/restore-orgspace-backup.self-test.mjs
run_step "pnpm test:production-stack" env ORGSPACE_TEST_CLEANUP_VOLUMES=1 pnpm test:production-stack
run_step "pnpm test:e2e" pnpm test:e2e

echo "verify-phase0: PASS"
