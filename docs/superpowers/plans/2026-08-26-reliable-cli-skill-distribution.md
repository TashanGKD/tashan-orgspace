# Reliable OrgSpace Skill/CLI Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the OrgSpace Skill and native `torg` CLI from an immutable `orgspace.tashan.chat` mirror with fail-closed GitHub fallback, then prove two context-free users can install and authenticate without Node.js or Tailscale.

**Architecture:** Release schema v2 is the single source of truth for version, official distribution origin, GitHub repository, Skill asset, and native CLI assets. AUP exposes a read-only shared download directory through a dedicated Nginx location; user installers validate one source transaction at a time and only fall back on transport failure. A safe publisher validates an already-built release directory and atomically creates an immutable remote version.

**Tech Stack:** POSIX shell/Bash, Node.js 24, TypeScript 6, Vitest, Nginx, Docker Compose, GitHub Actions, rsync/SSH, SHA256.

---

## File responsibility map

- `release/cli-release.json` and `skill/tashan-orgspace/release.json` — identical release schema v2 metadata.
- `scripts/check-release-contract.mjs` — executable equality, URL, asset, workflow, and installer drift gate.
- `skill/tashan-orgspace/scripts/install-cli.sh` — user-scope dual-source CLI installer.
- `distribution/install-skill.sh` — stable, safe-default Skill installer source published at the unversioned HTTPS entry.
- `scripts/build-skill-release.mjs` — deterministic Skill archive builder with an exact file allowlist.
- `tests/distribution/install-cli.test.ts` and `tests/distribution/install-skill.test.ts` — isolated HOME adversarial installer tests.
- `.github/workflows/release-cli.yml` — native CLI builds, Skill build, unified checksums, GitHub prerelease.
- `deploy/compose.production.yml` and `deploy/nginx/aup-gateway.conf` — one exact read-only public-download bind and non-SPA static route.
- `scripts/check-production-contract.mjs` — machine gate for the only allowed host bind and static-route rules.
- `scripts/publish-public-distribution.sh` — read-only-by-default atomic mirror publisher.
- `scripts/publish-public-distribution.self-test.sh` — real-shape publisher refusal and atomicity tests.
- `scripts/smoke-public-distribution.sh` and `.self-test.sh` — HTTPS file/hash/cache/404 verification.
- `tests/production-stack/run.sh` and `stack.test.ts` — production-shaped static serving test.
- `README.md`, `skill/tashan-orgspace/SKILL.md`, and verification docs — user installation and evidence boundary.

### Task 1: Release schema v2 and alpha.3 contract

**Files:**
- Modify: `release/cli-release.json`
- Modify: `skill/tashan-orgspace/release.json`
- Modify: `apps/cli/package.json`
- Modify: `scripts/check-release-contract.mjs`
- Modify: `scripts/check-release-contract.self-test.mjs`

- [x] **Step 1: Write failing schema tests**

Add self-test cases requiring this exact shape and rejecting unknown/mutable HTTP sources:

```js
const release = {
  schemaVersion: 2,
  version: "0.1.0-alpha.3",
  nodeVersion: "24.14.0",
  repository: "TashanGKD/tashan-orgspace",
  apiUrl: "https://orgspace.tashan.chat",
  distributionBaseUrl: "https://orgspace.tashan.chat/downloads/orgspace",
  skillAsset: "tashan-orgspace-skill-v0.1.0-alpha.3.tar.gz",
  platforms: [
    { id: "darwin-arm64", asset: "torg-v0.1.0-alpha.3-darwin-arm64.tar.gz" },
    { id: "darwin-x64", asset: "torg-v0.1.0-alpha.3-darwin-x64.tar.gz" },
    { id: "linux-x64", asset: "torg-v0.1.0-alpha.3-linux-x64.tar.gz" },
  ],
};
assert.throws(
  () => checkReleaseContract({ ...release, distributionBaseUrl: "http://example.test" }, cli, skill),
  /distributionBaseUrl must be the OrgSpace HTTPS download origin/,
);
```

- [x] **Step 2: Run RED**

Run: `node scripts/check-release-contract.self-test.mjs`  
Expected: FAIL because schema v1 rejects the new required fields.

- [x] **Step 3: Implement schema v2 and bump alpha.3 everywhere**

Require exact fields, exact official origin, exact Skill asset name, and identical release documents. Update CLI package and three platform asset names to `0.1.0-alpha.3`.

- [x] **Step 4: Run GREEN and drift search**

Run:

```bash
node scripts/check-release-contract.self-test.mjs
node scripts/check-release-contract.mjs
rg -n '0\.1\.0-alpha\.2' apps/cli release skill README.md
```

Expected: both gates PASS; remaining alpha.2 references are historical evidence only.

- [x] **Step 5: Commit**

```bash
git add apps/cli/package.json release/cli-release.json skill/tashan-orgspace/release.json scripts/check-release-contract.mjs scripts/check-release-contract.self-test.mjs
git commit -m "release(distribution): define alpha 3 sources"
```

### Task 2: Fail-closed dual-source CLI installer

**Files:**
- Modify: `tests/distribution/install-cli.test.ts`
- Modify: `skill/tashan-orgspace/scripts/install-cli.sh`

- [x] **Step 1: Encode transport and integrity pathologies**

Extend fixtures with two independent source directories and a fake `curl` log. Add tests asserting:

```ts
expect(primarySuccess.status).toBe(0);
expect(readFileSync(curlLog, "utf8")).not.toContain("fallback");

expect(primaryTransportFailure.status).toBe(0);
expect(readFileSync(curlLog, "utf8")).toMatch(/primary[\s\S]*fallback/);

expect(primaryBadChecksum.status).not.toBe(0);
expect(primaryBadChecksum.stderr).toContain("integrity failure from official");
expect(readFileSync(curlLog, "utf8")).not.toContain("fallback");
```

Also test both transports failing, duplicate checksum entries, asset 404 after checksum, failed upgrade preservation, and no-argument zero network/write behavior.

- [x] **Step 2: Run RED**

Run: `pnpm vitest run tests/distribution/install-cli.test.ts`  
Expected: FAIL because the installer only has `TORG_RELEASE_BASE_URL` and one GitHub source.

- [x] **Step 3: Implement one-source transactions**

Add bounded production curl options and a source loop equivalent to:

```sh
official_base="$distribution_base/v$version"
github_base="https://github.com/$repository/releases/download/v$version"
for source in official github; do
  # create a fresh per-source directory
  # transport failure: clean it and continue
  # parse/duplicate/hash/layout failure: fail immediately
  # promote verified archive only after the transaction succeeds
done
```

Production ignores all source overrides. `TORG_INSTALL_TESTING=1` may set `TORG_PRIMARY_RELEASE_BASE_URL` and `TORG_FALLBACK_RELEASE_BASE_URL`. Use `--connect-timeout 10 --max-time 120 --retry 2 --retry-all-errors` with HTTPS/TLS enforcement in production.

- [x] **Step 4: Run GREEN and shell checks**

Run:

```bash
pnpm vitest run tests/distribution/install-cli.test.ts
shellcheck skill/tashan-orgspace/scripts/install-cli.sh 2>/dev/null || true
```

Expected: installer tests PASS; shellcheck produces no actionable error when installed.

- [x] **Step 5: Commit**

```bash
git add tests/distribution/install-cli.test.ts skill/tashan-orgspace/scripts/install-cli.sh
git commit -m "fix(distribution): add fail-closed CLI fallback"
```

### Task 3: Versioned Skill archive and safe installer

**Files:**
- Create: `scripts/build-skill-release.mjs`
- Create: `distribution/install-skill.sh`
- Create: `tests/distribution/build-skill-release.test.ts`
- Create: `tests/distribution/install-skill.test.ts`
- Modify: `package.json`

- [x] **Step 1: Write archive and installer rejection tests**

The builder test must assert the exact tar entries and reject a non-empty output directory. The installer tests must cover unmanaged target, bad hash, duplicate checksum, symlink/archive escape, missing required Skill file, idempotent reinstall, failed upgrade preservation, relative `CODEX_HOME`, and no-argument read-only behavior.

- [x] **Step 2: Run RED**

Run:

```bash
pnpm vitest run tests/distribution/build-skill-release.test.ts tests/distribution/install-skill.test.ts
```

Expected: FAIL because both implementation files are absent.

- [x] **Step 3: Implement deterministic builder**

Build `tashan-orgspace-skill-v<version>.tar.gz` with top-level `tashan-orgspace/` and only:

```text
SKILL.md
agents/openai.yaml
capability-references.json
references/authentication.md
references/safety.md
release.json
scripts/install-cli.sh
```

Emit a sibling `.sha256` file using the exact asset name.

- [x] **Step 4: Implement safe-default Skill installer**

`distribution/install-skill.sh` embeds the alpha.3 version and official base URL, defaults to help, supports `--check` and `--install`, validates checksum and exact archive layout, refuses unmanaged targets, stages under the destination parent, then atomically activates the Skill. It prints the pinned GitHub tag fallback instruction only after official transport failure.

- [x] **Step 5: Run GREEN and distribution suite**

Run:

```bash
pnpm vitest run tests/distribution/build-skill-release.test.ts tests/distribution/install-skill.test.ts
pnpm test:distribution
```

Expected: PASS with zero partial installations.

- [x] **Step 6: Commit**

```bash
git add scripts/build-skill-release.mjs distribution/install-skill.sh tests/distribution package.json
git commit -m "feat(distribution): package installable Skill"
```

### Task 4: Unified GitHub Release and consistency gates

**Files:**
- Modify: `.github/workflows/release-cli.yml`
- Modify: `scripts/check-release-contract.mjs`
- Modify: `scripts/check-release-contract.self-test.mjs`

- [x] **Step 1: Add failing workflow assertions**

Require a `skill` artifact job, exactly one Skill archive, three CLI archives, four `.sha256` inputs, and one sorted `SHA256SUMS`. Assert `gh release create` includes the Skill archive.

- [x] **Step 2: Run RED**

Run: `node scripts/check-release-contract.self-test.mjs`  
Expected: FAIL with `release workflow missing Skill artifact`.

- [x] **Step 3: Add Skill build job and unified publish**

Build the Skill archive once on Ubuntu after verification, upload it as `skill`, download `cli-*` plus `skill`, require four archives/four checksum fragments, validate all four, and publish all archives with `SHA256SUMS`.

- [x] **Step 4: Run GREEN**

Run:

```bash
node scripts/check-release-contract.self-test.mjs
node scripts/check-release-contract.mjs
pnpm exec prettier --check .github/workflows/release-cli.yml
```

- [x] **Step 5: Commit**

```bash
git add .github/workflows/release-cli.yml scripts/check-release-contract.mjs scripts/check-release-contract.self-test.mjs
git commit -m "ci(distribution): publish Skill with CLI assets"
```

### Task 5: Read-only AUP download mount and Nginx route

**Files:**
- Modify: `deploy/compose.production.yml`
- Modify: `deploy/nginx/aup-gateway.conf`
- Modify: `scripts/check-production-contract.mjs`
- Modify: `scripts/check-production-contract.self-test.mjs`
- Modify: `tests/production-stack/run.sh`
- Modify: `tests/production-stack/stack.test.ts`

- [x] **Step 1: Write failing contract and production-stack tests**

Require the one allowed bind:

```yaml
- type: bind
  source: ${ORGSPACE_PUBLIC_DOWNLOADS_DIR:-/home/aup/tashan-orgspace/shared/public-downloads}
  target: /usr/share/nginx/html/downloads/orgspace
  read_only: true
```

Add tests that a fixture file returns 200, an unknown download returns 404 without React HTML, POST returns 405, versioned files are immutable-cacheable, and `install-skill.sh` is not immutable-cacheable.

- [x] **Step 2: Run RED**

Run:

```bash
node scripts/check-production-contract.self-test.mjs
ORGSPACE_TEST_CLEANUP_VOLUMES=1 pnpm test:production-stack
```

Expected: contract or stack FAIL because no download mount/location exists.

- [x] **Step 3: Implement the only allowed bind and static locations**

Allow exactly the gateway source/target/read-only bind while continuing to reject every other bind. Add Nginx locations for the stable installer and versioned directory using `try_files $uri =404`, GET/HEAD only, no autoindex, and correct cache headers.

- [x] **Step 4: Run GREEN and negative self-test**

Run the two commands from Step 2. Expected: PASS, including self-test mutations for writable mount, wrong host path, SPA fallback, and directory listing.

- [x] **Step 5: Commit**

```bash
git add deploy scripts/check-production-contract* tests/production-stack
git commit -m "feat(distribution): serve immutable AUP downloads"
```

### Task 6: Safe atomic mirror publisher

**Files:**
- Create: `scripts/publish-public-distribution.sh`
- Create: `scripts/publish-public-distribution.self-test.sh`
- Modify: `scripts/check-gate-self-tests.mjs`
- Modify: `scripts/check-gate-self-tests.self-test.mjs`

- [x] **Step 1: Encode adversarial publisher inputs**

The self-test fake SSH/rsync layer must prove refusal for `../../version`, missing/extra archives, duplicate checksum entries, symlink input, dirty tracked files, tag/manifest mismatch, existing remote version, wrong remote root, and `--apply` without confirmation. It must also prove no arguments and `--preflight` perform no remote writes.

- [x] **Step 2: Run RED**

Run: `bash scripts/publish-public-distribution.self-test.sh`  
Expected: FAIL because the publisher does not exist.

- [x] **Step 3: Implement publisher**

Usage:

```text
scripts/publish-public-distribution.sh
scripts/publish-public-distribution.sh --preflight --source-dir <dir>
scripts/publish-public-distribution.sh --apply --confirm-production --source-dir <dir>
```

The publisher reads version/assets from the release manifest, validates four exact archives and `SHA256SUMS`, verifies the current exact tag, uploads to `$remoteRoot/shared/public-downloads/.staging/v$version-$$`, revalidates remotely, refuses existing `v$version`, atomically renames staging, then atomically updates only `install-skill.sh`.

- [x] **Step 4: Run GREEN and gate discovery**

Run:

```bash
bash scripts/publish-public-distribution.self-test.sh
node scripts/check-gate-self-tests.mjs
node scripts/check-gate-self-tests.self-test.mjs
```

- [x] **Step 5: Commit**

```bash
git add scripts/publish-public-distribution* scripts/check-gate-self-tests*
git commit -m "feat(distribution): publish mirror atomically"
```

### Task 7: Public distribution smoke and documentation

**Files:**
- Create: `scripts/smoke-public-distribution.sh`
- Create: `scripts/smoke-public-distribution.self-test.sh`
- Modify: `README.md`
- Modify: `skill/tashan-orgspace/SKILL.md`
- Modify: `docs/verification/2026-08-26-public-control-plane.md`
- Modify: `scripts/check-gate-self-tests.mjs`

- [x] **Step 1: Write failing smoke self-test**

Fake curl responses must prove the smoke detects missing assets, wrong content length, checksum mismatch, stable installer immutable caching, version file missing immutable caching, unknown path returning HTML/200, and secret-like output.

- [x] **Step 2: Run RED**

Run: `bash scripts/smoke-public-distribution.self-test.sh`  
Expected: FAIL because the smoke script is absent.

- [x] **Step 3: Implement smoke and user instructions**

The smoke reads release metadata, downloads five public files to a temporary directory, validates four hashes and response headers, asserts an unknown versioned file is 404, and prints only version/asset/hash status. README documents official installation first and pinned GitHub Skill fallback second; Skill explains CLI source selection without claiming unimplemented capabilities.

- [x] **Step 4: Run GREEN and stale-reference search**

Run:

```bash
bash scripts/smoke-public-distribution.self-test.sh
node scripts/check-gate-self-tests.mjs
rg -n 'GitHub Release.*only|only.*GitHub Release|0\.1\.0-alpha\.2' README.md skill docs
```

- [x] **Step 5: Commit**

```bash
git add scripts/smoke-public-distribution* scripts/check-gate-self-tests.mjs README.md skill/tashan-orgspace/SKILL.md docs/verification/2026-08-26-public-control-plane.md
git commit -m "docs(distribution): document official installer"
```

### Task 8: Full verification, PR, and merge

**Files:**
- Modify: `docs/superpowers/plans/2026-08-26-reliable-cli-skill-distribution.md`

- [x] **Step 1: Run complete local verifier**

Run: `ORGSPACE_TEST_CLEANUP_VOLUMES=1 bash scripts/verify-phase0.sh`  
Expected: PASS with all existing tests plus dual-source, Skill installer, publisher, mirror smoke, and production static tests.

- [ ] **Step 2: Review diff and security boundaries**

Run:

```bash
git diff origin/main...HEAD --check
git status --short
rg -n 'curl \|.*sh|--insecure|tls.*false|0\.0\.0\.0.*44110|docker\.sock' distribution skill scripts deploy
```

Expected: no unsafe bootstrap, TLS bypass, public AUP listener, or Docker socket mount.

- [ ] **Step 3: Push and open a reviewed PR**

Push `codex/reliable-cli-distribution`, create a PR to `main`, include the two original fresh-user failures and new negative tests, then wait for all CI and review comments.

- [ ] **Step 4: Merge only after gates**

Use merge commit, delete the remote feature branch, and record the merge SHA. Do not tag from the feature branch.

### Task 9: Deploy, tag alpha.3, and populate official mirror

**Files:**
- Runtime: `/home/aup/tashan-orgspace/shared/public-downloads`
- Update evidence: `docs/verification/2026-08-26-public-control-plane.md`

- [ ] **Step 1: Deploy the exact merged commit**

From a clean worktree at merged `main`:

```bash
scripts/deploy-orgspace.sh --preflight
scripts/deploy-orgspace.sh --apply --confirm-production
```

Verify `.deployed-commit`, public health, loopback-only listener, and existing Panshi maintenance isolation.

- [ ] **Step 2: Tag exact merge and wait for Release**

Create annotated `v0.1.0-alpha.3` only at the deployed merge. Wait for verify, Skill, three native builds, and publish; verify four archives plus unified checksums.

- [ ] **Step 3: Publish the official mirror**

Download the GitHub Release into a fresh empty directory, verify it, then run publisher preflight and explicit apply. No asset may overwrite an existing version.

- [ ] **Step 4: Run real public smoke**

Run `bash scripts/smoke-public-distribution.sh`. Expected: official installer and all alpha.3 assets PASS; unknown asset is 404; production health remains alpha.3.

### Task 10: Two truly context-free users and real account lifecycle

**Files:**
- Update evidence: `docs/verification/2026-08-26-public-control-plane.md`

- [ ] **Step 1: Spawn two new agents with no inherited turns**

Use `fork_turns=none`. Each task contains only one phone number and `https://orgspace.tashan.chat/downloads/orgspace/install-skill.sh`. The agent may read only the downloaded Skill and direct references after installation.

- [ ] **Step 2: Independently install Skill and CLI**

Each agent uses separate HOME/CODEX_HOME/XDG directories and no system Node.js/Tailscale/source. Require version alpha.3, health ok, 17 capabilities, and idempotent reinstall.

- [ ] **Step 3: Send and consume separate SMS challenges**

Each agent sends its own registration code with a unique idempotency key, stops for the user's code, then registers with a separate secret via stdin. Never cross-route codes or expose secrets.

- [ ] **Step 4: Prove identity and device isolation**

For each user, run `whoami`, `device list`, and `org list`. On one account create a second isolated device login, revoke the first device, prove the old token fails and the second remains valid. Confirm the two account IDs differ.

- [ ] **Step 5: Record redacted evidence and close the milestone**

Record gateway acceptance separately from phone receipt. Delete temporary passwords/codes/tokens after the test. Mark Task 9/10 acceptance complete only after both independent agents finish; otherwise preserve the precise blocker.
