# Web platform foundation verification — 2026-08-19

## Scope

This record covers the Web platform foundation on branch `codex/web-platform` through commit
`c035a08`. It records local implementation evidence only. It is not evidence of a push, merge,
production release, AUP deployment, domain configuration or visual acceptance.

## Static, formatting and type evidence

Command:

```bash
bash scripts/verify-phase0.sh
```

Result: `verify-phase0: PASS`. The verifier completed toolchain validation, repository formatting,
ESLint and all workspace TypeScript checks with exit code 0.

## Unit, distribution and rejection-test evidence

The same verifier completed all workspace unit suites with exit code 0. The Web suite reported 10
test files and 42 passing tests. Distribution verification reported 2 files and 15 passing tests,
then both fresh-user installer checks passed, including the local `darwin-arm64` install without a
system Node.js runtime.

The focused Web rejection suite was also run separately:

```bash
pnpm --filter @tashan/web exec vitest run \
  src/platform/modules/module-catalog.test.ts \
  src/platform/session/session-context.test.tsx \
  src/platform/context/organization-context.test.tsx \
  src/platform/shell/app-shell.test.tsx \
  src/api.test.ts
```

Result: 5 test files and 24 tests passed. These cover invalid module catalogs, session restoration,
organization-boundary state, role-aware navigation and unsafe API-origin rejection.

## PostgreSQL and Redis E2E evidence

`bash scripts/verify-phase0.sh` started isolated local PostgreSQL and Redis containers, ran the E2E
suite, and removed the containers and network afterward. Result: 3 test files and 3 tests passed.
No remote database was used.

## Capability gate and self-test evidence

Commands:

```bash
node scripts/check-capability-coverage.mjs
node scripts/check-capability-coverage.self-test.mjs
node scripts/check-gate-self-tests.mjs
```

Results:

- repository coverage: PASS, 0 violations, 17 server capabilities;
- capability gate self-test: PASS;
- gate inventory: PASS, 0 violations, 6 gates.

The capability self-test constructs and rejects missing Web coverage, a non-absolute route, a
repository-shaped missing test file, duplicate Web capability IDs and duplicate Web action IDs.
The repository gate now binds every `web: required` capability to a route, action and existing Web
test file. Fourteen of the 17 Phase 0 capabilities are marked `web: required`; the three generic
system/capability-discovery endpoints remain deferred.

## Production Web build evidence

Command:

```bash
pnpm --filter @tashan/web build
find apps/web/dist -maxdepth 2 -type f -print | sort
```

Result: TypeScript and Vite completed with exit code 0. The build emitted:

```text
apps/web/dist/index.html
apps/web/dist/assets/index-Dx6Kf_5t.js
apps/web/dist/assets/index-KJakjLE7.css
```

The hashed asset names are build-specific and are not a release contract.

## Gate mechanism observations

Task assessment: the planned Web foundation, same-origin API composition and stronger capability
coverage gate are implemented and locally verified. Production operations and human visual
acceptance remain outside this task.

Mechanisms that fired in this cycle:

1. The initial object-shaped capability self-test failed against the old string-only gate with
   `Web surfaces must be an array of capability IDs`, proving that the red test observed the old
   behavior before implementation.
2. Both relevant commits ran the repository commit hook. The hook executed formatting, lint,
   typecheck, all unit tests, capability coverage, the six-gate inventory and every gate self-test;
   both commit attempts completed only after those commands returned success.
3. The final full verifier exercised the capability gate again after distribution tests and before
   local database E2E, and ended with `verify-phase0: PASS`.

Mechanism miss observed and corrected: the first missing-file fixture used `missing.test.tsx`, so
the path-shape validator fired before the intended existence branch. The self-test itself failed,
rather than falsely reporting coverage. The fixture was changed to
`apps/web/src/missing.test.tsx`; the final self-test now reaches and proves the `missing Web test
file` branch. One remaining limitation is explicit: the gate verifies that the declared test file
exists, but does not parse test source to prove that every declared action is asserted by name.

## Explicitly not verified or performed

- No browser-based visual or responsive acceptance was run.
- No accessibility audit beyond component-level assertions was run.
- No AUP login, upload, server mutation or deployment was performed.
- No `tashan.chat` HTTPS domain, reverse proxy or authentication gateway was configured.
- No branch push, pull request, merge or release was performed.
