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
run_step "pnpm test:distribution" pnpm test:distribution
run_step "node scripts/check-capability-coverage.mjs" node scripts/check-capability-coverage.mjs
run_step "node scripts/check-release-contract.mjs" node scripts/check-release-contract.mjs
run_step "node scripts/check-gate-self-tests.mjs" node scripts/check-gate-self-tests.mjs
run_step "node scripts/check-capability-coverage.self-test.mjs" node scripts/check-capability-coverage.self-test.mjs
run_step "node scripts/check-release-contract.self-test.mjs" node scripts/check-release-contract.self-test.mjs
run_step "node scripts/check-gate-self-tests.self-test.mjs" node scripts/check-gate-self-tests.self-test.mjs
run_step "node scripts/check-commit-evidence.self-test.mjs" node scripts/check-commit-evidence.self-test.mjs
run_step "pnpm test:e2e" pnpm test:e2e

echo "verify-phase0: PASS"
