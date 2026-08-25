# OrgSpace Public Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the existing Phase 0 OrgSpace API, Web, Worker, PostgreSQL, and Redis as an isolated AUP production stack reachable at `https://orgspace.tashan.chat`, then publish a CLI/Skill release that external users can install and use without Tailscale.

**Architecture:** ECS terminates wildcard TLS and proxies only to loopback port `14010`; an AUP-owned `autossh` process forwards that port to the AUP stack's loopback-only gateway on `44110`. The gateway serves the Web app and proxies `/v1` to the API; API, Worker, PostgreSQL, and Redis remain on an isolated Compose network. Tailscale is used only for operator deployment and never appears in the user path.

**Tech Stack:** Node.js 24, pnpm 10, TypeScript, Fastify, React/Vite, PostgreSQL 17, Redis 8, Docker Compose v5, Nginx, autossh, GitHub Actions, Bash and Vitest.

---

## Verified contract evidence

- `apps/api/src/routes/capability-routes.ts:12` mounts the real health endpoint at `/v1/health` and returns the `HealthResponse` contract.
- `apps/api/src/server.ts:56` binds the API to the configured host and port.
- `apps/api/src/config.ts:53-111` is the API environment source of truth; production already requires explicit CORS, non-loopback PostgreSQL/Redis, phone verification secrets, and JWT keys.
- `apps/web/src/api-origin.ts:1-28` validates the development proxy origin; production Web calls same-origin `/v1` and does not own a separate backend URL.
- `release/cli-release.json:6` and `skill/tashan-orgspace/release.json:6` already fix the production CLI API URL to `https://orgspace.tashan.chat`.
- `.github/workflows/release-cli.yml:105-117` refuses a stable CLI release unless the real HTTPS health endpoint returns `{status:"ok"}`.
- Read-only infrastructure checks on 2026-08-25 found no `/home/aup/tashan-orgspace`, no ECS `orgspace.tashan.chat` vhost, AUP loopback `44110` free, ECS loopback `14010` free, `autossh` installed, the AUP tunnel key present with mode `0600`, and the ECS wildcard certificate at `/etc/ssl/wildcard-tashan/`.

## File structure

- `deploy/production-contract.json`: single source for public host, AUP/ECS aliases, remote root, Compose project, loopback ports, and certificate paths.
- `deploy/compose.production.yml`: isolated AUP API/Web/Worker/PostgreSQL/Redis/gateway stack.
- `deploy/Dockerfile.runtime`: immutable Node runtime image for migrations, API, and Worker.
- `deploy/Dockerfile.web`: Web build copied into an unprivileged Nginx image.
- `deploy/nginx/aup-gateway.conf`: same-origin Web plus `/v1` proxy inside AUP.
- `deploy/nginx/ecs-orgspace.conf`: ECS TLS vhost that proxies to `127.0.0.1:14010`.
- `deploy/env.production.example`: names-only production secret contract with no values.
- `deploy/start-tunnel.sh`: AUP-side, explicit-apply, fail-closed tunnel manager.
- `scripts/check-production-contract.mjs`: consistency and unsafe-default gate.
- `scripts/check-production-contract.self-test.mjs`: real-shape negative tests for drift and unsafe values.
- `scripts/deploy-orgspace.sh`: safe deployment entrypoint; default is a read-only plan, `--apply` mutates only OrgSpace paths.
- `scripts/deploy-orgspace.self-test.sh`: fake-transport tests for no-argument safety, path isolation, and failure rollback.
- `scripts/configure-orgspace-ingress.sh`: safe ECS vhost/tunnel installer with explicit `--apply`.
- `scripts/configure-orgspace-ingress.self-test.sh`: rejection and unrelated-vhost preservation tests.
- `scripts/smoke-production.sh`: read-only HTTPS and CLI smoke test with secret-redaction assertions.
- `docs/runbooks/production-control-plane.md`: deploy, monitor, recover, back up, and roll back instructions.
- `docs/verification/2026-08-25-public-control-plane.md`: observed local, AUP, ECS, public HTTPS, and fresh-user evidence.

### Task 1: Make production identity and health explicit

**Files:**
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/config.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/routes/capability-routes.ts`
- Modify: `apps/api/test/http/api.integration.test.ts`
- Modify: `apps/api/test/http/phone-auth.integration.test.ts`
- Modify: `apps/cli/test/cli-api.integration.test.ts`
- Modify: `tests/e2e/support/api-process.ts`

- [x] **Step 1: Write failing config tests**

Add tests proving production rejects an empty or placeholder `SERVICE_VERSION` and accepts a SemVer build identity:

```ts
expect(() => loadConfig(productionEnvironment({ SERVICE_VERSION: "" }))).toThrow(
  "SERVICE_VERSION is required",
);
expect(() => loadConfig(productionEnvironment({ SERVICE_VERSION: "dev" }))).toThrow(
  "production SERVICE_VERSION must be a release version",
);
expect(loadConfig(productionEnvironment({ SERVICE_VERSION: "0.1.0-alpha.2" })).serviceVersion).toBe(
  "0.1.0-alpha.2",
);
```

- [x] **Step 2: Run the tests and verify RED**

Run: `pnpm --filter @tashan/api test -- src/config.test.ts`

Expected: FAIL because `serviceVersion` is not loaded or validated.

- [x] **Step 3: Implement the minimal service-version contract**

Load `SERVICE_VERSION`, require it in production, reject `dev`, `unknown`, `test`, and placeholders, and pass it through `BuildAppOptions`. Change `registerCapabilityRoutes(app)` to `registerCapabilityRoutes(app, { serviceVersion })`, then return it in `HealthResponse.version` instead of the hard-coded `0.0.0`.

- [x] **Step 4: Add and run the health integration test**

Pass the explicit test service version to every non-production `buildApp` call site in API integration, CLI integration, and E2E support. Assert `GET /v1/health` returns the injected version and a valid timestamp. Run:

```bash
pnpm --filter @tashan/api test -- src/config.test.ts
pnpm --filter @tashan/api test:integration -- test/http/api.integration.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/api/src/config.ts apps/api/src/config.test.ts apps/api/src/app.ts \
  apps/api/src/routes/capability-routes.ts apps/api/test/http/api.integration.test.ts \
  apps/api/test/http/phone-auth.integration.test.ts apps/cli/test/cli-api.integration.test.ts \
  tests/e2e/support/api-process.ts
git commit -m "feat(deploy): expose production build identity"
```

### Task 2: Add an isolated production Compose stack

**Files:**
- Create: `.dockerignore`
- Create: `deploy/Dockerfile.runtime`
- Create: `deploy/Dockerfile.web`
- Create: `deploy/compose.production.yml`
- Create: `deploy/nginx/aup-gateway.conf`
- Create: `deploy/env.production.example`
- Create: `scripts/check-production-contract.mjs`
- Create: `scripts/check-production-contract.self-test.mjs`

- [x] **Step 1: Write the failing production-contract gate and negative self-test**

The gate must parse Compose and supporting files and fail on these real-shape violations:

```text
API/gateway publish 0.0.0.0 instead of 127.0.0.1
postgres or redis has a host port
docker.sock or /home is mounted
NODE_ENV is not production
SERVICE_VERSION is absent
gateway does not proxy /v1 to api:4110
project name is not tashan-orgspace-prod
```

The self-test copies fixtures to a temporary directory, injects each violation independently, and asserts the gate exits non-zero with the exact violated invariant.

- [x] **Step 2: Run the self-test and verify RED**

Run: `node scripts/check-production-contract.self-test.mjs`

Expected: FAIL because the gate and production files do not yet exist.

- [x] **Step 3: Implement the production images and Compose stack**

Use pinned base images. The runtime image installs the frozen workspace and starts one of these commands supplied by Compose:

```yaml
name: tashan-orgspace-prod
services:
  migrate:
    command: ["pnpm", "--filter", "@tashan/api", "db:migrate"]
  api:
    command: ["pnpm", "--filter", "@tashan/api", "start"]
  worker:
    command: ["pnpm", "--filter", "@tashan/worker", "start"]
  gateway:
    ports: ["127.0.0.1:44110:8080"]
```

Only `gateway` publishes a port. PostgreSQL and Redis use named volumes and internal DNS. API receives `DATABASE_URL=postgresql://...@postgres:5432/orgspace`, `REDIS_URL=redis://redis:6379`, `HOST=0.0.0.0`, `PORT=4110`, `CORS_ORIGINS=https://orgspace.tashan.chat`, `JWT_ISSUER=https://orgspace.tashan.chat`, and `TRUSTED_PROXY_CIDRS=172.31.64.0/24`. Define that subnet explicitly and place gateway at `172.31.64.10` so client-IP trust is bounded.

- [x] **Step 4: Run contract and Docker config checks**

```bash
node scripts/check-production-contract.mjs
node scripts/check-production-contract.self-test.mjs
```

Expected: all PASS without starting containers or writing production state. The contract gate itself must run `docker compose config --quiet` with generated non-secret fixture values so the committed example file can remain names-only.

- [x] **Step 5: Commit**

```bash
git add .dockerignore deploy scripts/check-production-contract.mjs \
  scripts/check-production-contract.self-test.mjs
git commit -m "feat(deploy): add isolated production stack"
```

### Task 3: Encode one production deployment contract

**Files:**
- Create: `deploy/production-contract.json`
- Modify: `scripts/check-production-contract.mjs`
- Modify: `scripts/check-production-contract.self-test.mjs`
- Modify: `release/cli-release.json`
- Modify: `skill/tashan-orgspace/release.json`

- [x] **Step 1: Add failing drift cases**

Require all consumers to agree with this manifest:

```json
{
  "publicOrigin": "https://orgspace.tashan.chat",
  "healthPath": "/v1/health",
  "aupHostAlias": "aup-server",
  "ecsHostAlias": "tashan-ecs",
  "remoteRoot": "/home/aup/tashan-orgspace",
  "composeProject": "tashan-orgspace-prod",
  "aupLoopbackPort": 44110,
  "ecsLoopbackPort": 14010,
  "ecsCertificate": "/etc/ssl/wildcard-tashan/fullchain.cer",
  "ecsCertificateKey": "/etc/ssl/wildcard-tashan/tashan.chat.key"
}
```

Inject a mismatched CLI URL, Nginx upstream port, Compose project, and remote root; each must fail with a targeted error.

- [x] **Step 2: Verify RED, implement, and verify GREEN**

Run the self-test before and after extending the gate:

```bash
node scripts/check-production-contract.self-test.mjs
node scripts/check-production-contract.mjs
node scripts/check-release-contract.mjs
```

Expected before: FAIL on missing manifest checks. Expected after: PASS.

- [x] **Step 3: Commit**

```bash
git add deploy/production-contract.json scripts/check-production-contract.mjs \
  scripts/check-production-contract.self-test.mjs release/cli-release.json \
  skill/tashan-orgspace/release.json
git commit -m "ci(deploy): gate production contract drift"
```

### Task 4: Build a safe AUP deployment command

**Files:**
- Create: `scripts/deploy-orgspace.sh`
- Create: `scripts/deploy-orgspace.self-test.sh`

- [x] **Step 1: Write adversarial deployment tests**

The fake `ssh`, `rsync`, and `docker` binaries must record invocations. Assert:

```text
no arguments prints a plan and records zero remote mutations
--apply refuses a dirty worktree
--apply refuses a missing or non-0600 remote .env.production
a remote root outside /home/aup/tashan-orgspace is rejected
a compose project other than tashan-orgspace-prod is rejected
migration/build failure does not write .deployed-commit or reload ingress
the script includes its own path in the dirty-worktree watched set
```

- [x] **Step 2: Run and verify RED**

Run: `bash scripts/deploy-orgspace.self-test.sh`

Expected: FAIL because the deploy command does not exist.

- [x] **Step 3: Implement default read-only and explicit apply**

The interface is:

```text
scripts/deploy-orgspace.sh              # print local/remote plan only
scripts/deploy-orgspace.sh --preflight  # read-only SSH checks
scripts/deploy-orgspace.sh --apply      # sync immutable checkout, build, migrate, up
scripts/deploy-orgspace.sh --rollback <commit> --confirm-production
```

`--apply` must require `--confirm-production`, a clean tracked worktree, an exact contract, remote secret-file mode `600`, free port `44110`, and successful `docker compose config`. Sync to a commit-specific release directory, never to another project's path. Run migration before switching the current symlink; after health passes, atomically update `current`, `.deployed-commit`, and append a tab-separated deploy-history record.

- [x] **Step 4: Run self-test and shell analysis**

```bash
bash scripts/deploy-orgspace.self-test.sh
bash -n scripts/deploy-orgspace.sh
scripts/deploy-orgspace.sh
```

Expected: PASS; final command prints a plan and makes no remote changes.

- [x] **Step 5: Commit**

```bash
git add scripts/deploy-orgspace.sh scripts/deploy-orgspace.self-test.sh
git commit -m "feat(deploy): add fail-closed AUP deployer"
```

### Task 5: Add the persistent tunnel and ECS TLS ingress

**Files:**
- Create: `deploy/start-tunnel.sh`
- Create: `deploy/nginx/ecs-orgspace.conf`
- Create: `scripts/configure-orgspace-ingress.sh`
- Create: `scripts/configure-orgspace-ingress.self-test.sh`
- Modify: `scripts/check-production-contract.mjs`
- Modify: `scripts/check-production-contract.self-test.mjs`

- [x] **Step 1: Encode at least three breaking inputs**

Test and reject: a non-loopback `-R` bind; an ECS port different from `14010`; a tunnel target different from `127.0.0.1:44110`; a Host other than `orgspace.tashan.chat`; an HTTP-only vhost; wildcard `proxy_pass`; a configuration operation that changes any existing enabled vhost.

- [x] **Step 2: Verify RED**

Run: `bash scripts/configure-orgspace-ingress.self-test.sh`

Expected: FAIL because the ingress scripts do not exist.

- [x] **Step 3: Implement safe ingress lifecycle**

`deploy/start-tunnel.sh` has no-argument help and requires `--apply`. It starts exactly:

```bash
autossh -M 0 -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 -i /home/aup/.ssh/tashan_tunnel \
  -R 127.0.0.1:14010:127.0.0.1:44110 root@101.200.234.115
```

The ECS template redirects HTTP to HTTPS, uses the verified wildcard certificate, enforces `server_name orgspace.tashan.chat`, sets bounded upload/header timeouts, forwards normalized proxy headers, and proxies to `http://127.0.0.1:14010`. The configure script installs only `/etc/nginx/sites-available/orgspace.tashan.chat`, validates `nginx -t`, atomically enables it, reloads Nginx, starts the AUP tunnel, and verifies both ECS-loopback and public health. It must restore the prior OrgSpace vhost on failure.

- [x] **Step 4: Verify GREEN**

```bash
bash scripts/configure-orgspace-ingress.self-test.sh
node scripts/check-production-contract.mjs
bash -n deploy/start-tunnel.sh scripts/configure-orgspace-ingress.sh
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add deploy/start-tunnel.sh deploy/nginx/ecs-orgspace.conf \
  scripts/configure-orgspace-ingress.sh scripts/configure-orgspace-ingress.self-test.sh \
  scripts/check-production-contract.mjs scripts/check-production-contract.self-test.mjs
git commit -m "feat(deploy): add public HTTPS ingress"
```

### Task 6: Add production smoke and recovery evidence

**Files:**
- Create: `scripts/smoke-production.sh`
- Create: `scripts/smoke-production.self-test.sh`
- Create: `docs/runbooks/production-control-plane.md`

- [x] **Step 1: Write failing smoke tests**

Use a local HTTPS fixture and fake `torg` to prove the smoke runner rejects HTTP, redirects to another host, malformed JSON, a version different from the expected release, token-like output, and a revoked session that still succeeds. No-argument execution must perform only `/v1/health` and capability discovery; account mutation requires `--account-lifecycle` plus credentials on stdin.

- [x] **Step 2: Verify RED**

Run: `bash scripts/smoke-production.self-test.sh`

Expected: FAIL because the smoke runner does not exist.

- [x] **Step 3: Implement the smoke runner and runbook**

Support:

```text
scripts/smoke-production.sh
scripts/smoke-production.sh --account-lifecycle --credentials-stdin
scripts/smoke-production.sh --recovery-check --confirm-production
```

The runbook must provide exact read-only status commands, OrgSpace-only restart steps, tunnel recovery, PostgreSQL backup/restore drill, rollback by commit, audit locations, and an explicit warning that Tailscale/SSH is operator-only.

- [x] **Step 4: Verify GREEN and commit**

```bash
bash scripts/smoke-production.self-test.sh
bash -n scripts/smoke-production.sh
git add scripts/smoke-production.sh scripts/smoke-production.self-test.sh \
  docs/runbooks/production-control-plane.md
git commit -m "test(deploy): add production recovery smoke"
```

### Task 7: Wire every new gate into CI

**Files:**
- Modify: `scripts/verify-phase0.sh`
- Modify: `scripts/check-gate-self-tests.mjs`
- Modify: `scripts/check-gate-self-tests.self-test.mjs`
- Modify: `.github/workflows/ci.yml`

- [x] **Step 1: Write a failing gate-discovery self-test**

Add a fixture that removes each of these self-tests and assert discovery fails:

```text
check-production-contract.self-test.mjs
deploy-orgspace.self-test.sh
configure-orgspace-ingress.self-test.sh
smoke-production.self-test.sh
```

- [x] **Step 2: Verify RED, wire gates, verify GREEN**

```bash
node scripts/check-gate-self-tests.self-test.mjs
bash scripts/verify-phase0.sh
```

Expected before: FAIL because new gates are not mandatory. Expected after: `verify-phase0: PASS` and every negative self-test visibly runs.

- [x] **Step 3: Commit**

```bash
git add scripts/verify-phase0.sh scripts/check-gate-self-tests.mjs \
  scripts/check-gate-self-tests.self-test.mjs .github/workflows/ci.yml
git commit -m "ci(deploy): enforce production safety gates"
```

### Task 8: Prove the production-shaped stack locally

**Files:**
- Create: `tests/production-stack/run.sh`
- Create: `tests/production-stack/stack.test.ts`
- Modify: `package.json`
- Modify: `scripts/verify-phase0.sh`

- [x] **Step 1: Write the failing production-stack test**

Assert the built stack serves Web `/`, returns same-origin `/v1/health`, reports the injected version, rejects a foreign CORS origin, preserves the client IP only from the fixed gateway subnet, and leaves PostgreSQL/Redis unreachable from host ports.

- [x] **Step 2: Verify RED**

Run: `pnpm test:production-stack`

Expected: FAIL because the production-stack runner is absent.

- [x] **Step 3: Implement isolated local execution**

Use a unique Compose project, temporary generated JWT/phone/database secrets, ports chosen by Docker or an explicit test override, and a trap that stops only this project. Do not delete named volumes unless `ORGSPACE_TEST_CLEANUP_VOLUMES=1` is explicitly set.

- [x] **Step 4: Verify GREEN and commit**

```bash
pnpm test:production-stack
bash scripts/verify-phase0.sh
git add tests/production-stack package.json scripts/verify-phase0.sh
git commit -m "test(deploy): verify production-shaped stack"
```

### Task 9: Prepare and deploy the isolated AUP stack

**Files:**
- Create on AUP: `/home/aup/tashan-orgspace/shared/.env.production` with mode `0600`
- Create from deployer: `/home/aup/tashan-orgspace/releases/<commit>`
- Create from deployer: `/home/aup/tashan-orgspace/current`
- Create from ingress installer: `/etc/nginx/sites-available/orgspace.tashan.chat` on ECS
- Create: `docs/verification/2026-08-25-public-control-plane.md`

- [x] **Step 1: Run read-only preflight**

```bash
scripts/deploy-orgspace.sh --preflight
scripts/configure-orgspace-ingress.sh --preflight
```

Expected: AUP/ECS reachable; ports `44110` and `14010` unused by unrelated processes; Docker/Compose/autossh/certificate available; remote OrgSpace secret file either valid or reported missing without printing values.

- [x] **Step 2: Create independent production secrets**

Generate a new PostgreSQL password, phone-code pepper, and Ed25519 JWT key pair specifically for OrgSpace. Copy approved Aliyun SMS credentials/sign/template into the OrgSpace secret file without displaying them. Validate names and non-empty values with a script that prints keys only, then enforce `chmod 600`.

- [x] **Step 3: Deploy with explicit production confirmation**

```bash
scripts/deploy-orgspace.sh --apply --confirm-production
scripts/configure-orgspace-ingress.sh --apply --confirm-production
```

Expected: only `tashan-orgspace-prod` containers, `/home/aup/tashan-orgspace`, ECS port `14010`, and the OrgSpace vhost change.

- [ ] **Step 4: Run production and recovery verification**

```bash
scripts/smoke-production.sh
scripts/smoke-production.sh --account-lifecycle --credentials-stdin
scripts/smoke-production.sh --recovery-check --confirm-production
```

Record commands, commit SHA, container versions, public HTTP status, tunnel restart evidence, redacted account lifecycle results, audit request IDs, and proof that Panshi/Ask endpoints remain healthy.

- [ ] **Step 5: Commit the redacted verification report**

```bash
git add docs/verification/2026-08-25-public-control-plane.md
git commit -m "docs(deploy): record public control plane evidence"
```

### Task 10: Publish the external-user CLI and Skill release

**Files:**
- Modify: `apps/cli/package.json`
- Modify: `release/cli-release.json`
- Modify: `skill/tashan-orgspace/release.json`
- Modify: `skill/tashan-orgspace/SKILL.md`
- Modify: `README.md`
- Modify: `docs/verification/2026-08-25-public-control-plane.md`

- [x] **Step 1: Bump one release version everywhere**

Use the next prerelease version after `0.1.0-alpha.1` and update the CLI package, release manifest, Skill manifest, Skill instructions, and README together. Do not create a stable tag until the stable-release health gate has passed on the deployed commit.

- [x] **Step 2: Run release and fresh-user gates**

```bash
bash scripts/verify-phase0.sh
node scripts/build-cli-release.mjs --output-dir dist
bash scripts/test-fresh-user-install.sh --local-build
```

Expected: PASS; installed binary uses HTTPS production origin, no Node/Tailscale dependency, and no secret output.

- [ ] **Step 3: Integrate and publish**

Push the reviewed branch, merge through the repository's normal protected flow, tag the exact verified commit, and let `.github/workflows/release-cli.yml` build the three native assets and checksum manifest. Never tag a dirty or different commit.

- [ ] **Step 4: Run an independent public-only acceptance**

From a temporary HOME with no repository checkout, Node.js, pnpm, or Tailscale, install the public Skill, install the published CLI, authenticate to the real HTTPS service, list capabilities and organizations, revoke the test device, and confirm the old token fails. Add only redacted evidence to the verification report.

- [ ] **Step 5: Commit final evidence**

```bash
git add docs/verification/2026-08-25-public-control-plane.md
git commit -m "docs(release): record public CLI acceptance"
```

## Completion gates

- `bash scripts/verify-phase0.sh` passes on the exact released commit.
- `pnpm test:production-stack` passes from a clean clone.
- `https://orgspace.tashan.chat/v1/health` returns HTTPS 200 with the released version.
- A fresh user can install Skill and CLI without Node.js or Tailscale and complete the real device-session lifecycle.
- Direct AUP service ports are not publicly reachable; PostgreSQL, Redis, Docker socket, host files, and other project paths remain inaccessible.
- Restart and tunnel-recovery drills restore service without duplicate side effects.
- Existing Panshi and Tashan Ask production health checks remain unchanged before and after deployment.
