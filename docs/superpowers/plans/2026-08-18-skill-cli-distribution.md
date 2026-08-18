# Tashan OrgSpace Skill And CLI Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish an installable Codex Skill that safely installs a self-contained `torg` CLI for a brand-new macOS or Linux user without requiring the source repository, Node.js, pnpm, or sudo.

**Architecture:** A single release manifest defines version, repository, production API origin, supported platforms, and asset names. CI bundles the TypeScript CLI into one ESM file and packages it with Node.js 24; the Skill's fail-closed installer downloads the pinned GitHub Release asset, validates checksum and archive layout, and atomically activates it in the user's home directory. Executable consistency gates bind manifest, CLI, Skill, assets, CI, and docs.

**Tech Stack:** Node.js 24, TypeScript 6, esbuild, Bash/POSIX tools, Vitest, GitHub Actions, Codex Skills.

---

## File map

- `release/cli-release.json` — machine-readable distribution source of truth.
- `scripts/check-release-contract.mjs` and `.self-test.mjs` — version, URL, platform, asset and Skill parity gate.
- `scripts/build-cli-release.mjs` and `.test.ts` — bundle and package one platform artifact.
- `skill/tashan-orgspace/SKILL.md` — agent instructions and safe command routing.
- `skill/tashan-orgspace/agents/openai.yaml` — Codex display metadata.
- `skill/tashan-orgspace/release.json` — pinned install metadata copied from the source manifest.
- `skill/tashan-orgspace/scripts/install-cli.sh` — fail-closed user-scope installer/upgrader.
- `skill/tashan-orgspace/references/` — authentication and command-safety details loaded only when relevant.
- `tests/distribution/install-cli.test.ts` — adversarial installer tests with isolated HOME and fixture assets.
- `scripts/test-fresh-user-install.sh` — clean-user local release smoke.
- `.github/workflows/release-cli.yml` — tag-gated multi-platform release production.

## Task 1: Establish the release contract and version gate

**Files:**

- Create: `release/cli-release.json`
- Create: `skill/tashan-orgspace/release.json`
- Create: `scripts/check-release-contract.mjs`
- Create: `scripts/check-release-contract.self-test.mjs`
- Modify: `apps/cli/package.json`
- Modify: `apps/cli/src/program.ts`
- Modify: `scripts/check-gate-self-tests.mjs`

- [x] **Step 1: Write the negative gate self-test**

Create fixtures for: CLI version drift, Skill version drift, non-HTTPS production API URL, repository drift, duplicate platform, traversal in an asset name, and an unsupported platform identifier. Each fixture must fail with the specific mismatched field.

- [x] **Step 2: Run the self-test and observe the missing module failure**

Run: `node scripts/check-release-contract.self-test.mjs`

Expected: FAIL because `check-release-contract.mjs` does not exist.

- [x] **Step 3: Add the release source of truth**

Use version `0.1.0-alpha.1`, repository `TashanGKD/tashan-orgspace`, API origin `https://orgspace.tashan.chat`, Node version `24.14.0`, and exact platforms `darwin-arm64`, `darwin-x64`, `linux-x64`. Asset names are `torg-v0.1.0-alpha.1-<platform>.tar.gz`.

Make `apps/cli/package.json` non-publishable but versioned at `0.1.0-alpha.1`. Read that package version in the CLI instead of hardcoding `0.0.0`; use it for Commander and device client metadata.

- [x] **Step 4: Implement and wire the gate**

The gate accepts explicit fixture paths for its self-test and repository paths for normal execution. It rejects unknown keys, unsafe URLs, duplicates and asset names not derived from version/platform. Wire it into pre-commit, CI and `verify-phase0.sh`; the existing gate inventory must count it and require its self-test.

- [x] **Step 5: Verify and commit**

Run:

```bash
node scripts/check-release-contract.self-test.mjs
node scripts/check-release-contract.mjs
pnpm --filter @tashan/cli test
pnpm --filter @tashan/cli typecheck
```

Expected: all pass and CLI reports `0.1.0-alpha.1`.

Commit: `feat(release): define CLI distribution contract`

## Task 2: Build a self-contained CLI archive

**Files:**

- Create: `scripts/build-cli-release.mjs`
- Create: `tests/distribution/build-cli-release.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.gitignore`

- [ ] **Step 1: Write artifact layout tests first**

The test invokes the builder into a temporary directory and requires exactly:

```text
torg-v<version>-<platform>/bin/torg
torg-v<version>-<platform>/lib/torg.mjs
torg-v<version>-<platform>/runtime/node
torg-v<version>-<platform>/THIRD_PARTY_NOTICES/Node-LICENSE
torg-v<version>-<platform>/VERSION
```

It runs the unpacked CLI with a PATH that contains no Node.js, verifies `--version`, and verifies no arguments only print help without network access.

- [ ] **Step 2: Run and observe the missing builder failure**

Run: `pnpm vitest run tests/distribution/build-cli-release.test.ts`

Expected: FAIL because `scripts/build-cli-release.mjs` does not exist.

- [ ] **Step 3: Implement the minimal builder**

Add esbuild as a pinned root development dependency. Bundle `apps/cli/src/main.ts` for Node 24, copy `process.execPath` and its Node license, generate a relocatable launcher that sets `TORG_ENV=production` and the manifest API URL, create the tarball with a single fixed top-level directory, and generate one adjacent `.sha256` file. Refuse dirty output directories, unsupported local platforms, missing Node license, and version overrides.

- [ ] **Step 4: Verify and commit**

Run:

```bash
pnpm vitest run tests/distribution/build-cli-release.test.ts
node scripts/build-cli-release.mjs --output-dir .local-data/release-smoke
```

Expected: test passes; local artifact runs without system Node in PATH.

Commit: `build(cli): create self-contained release artifact`

## Task 3: Implement the fail-closed Skill installer

**Files:**

- Create: `skill/tashan-orgspace/scripts/install-cli.sh`
- Create: `tests/distribution/install-cli.test.ts`

- [ ] **Step 1: Write adversarial installer tests before the happy path**

Use an isolated HOME and local fixture release source. Encode at least these failures:

- version `../../outside`;
- unsupported `freebsd-x64`;
- checksum mismatch and missing checksum entry;
- archive entry with `../`, absolute path, extra top-level directory or symlink;
- pre-existing unmanaged `torg` target;
- smoke failure after unpacking.

Every allocating failure must remove its temp directory and keep the previous installed version executable.

- [ ] **Step 2: Run and observe the missing installer failure**

Run: `pnpm vitest run tests/distribution/install-cli.test.ts`

Expected: FAIL because the installer does not exist.

- [ ] **Step 3: Implement safe install, check and upgrade modes**

No arguments prints usage and performs no network or writes. `--check` is read-only. `--install` downloads the pinned asset and checksums, validates exact archive entries before extraction, stages in the install root, smoke-tests, then atomically activates it. Test-only release URL/platform overrides require `TORG_INSTALL_TESTING=1`; without that guard they are ignored. Never use sudo or edit shell configuration.

- [ ] **Step 4: Run the adversarial and idempotency suite**

Run: `pnpm vitest run tests/distribution/install-cli.test.ts`

Expected: all rejection, rollback, first-install and second-install cases pass.

- [ ] **Step 5: Commit**

Commit: `feat(skill): add safe CLI installer`

## Task 4: Create the real Codex Skill

**Files:**

- Create: `skill/tashan-orgspace/SKILL.md`
- Create: `skill/tashan-orgspace/agents/openai.yaml`
- Create: `skill/tashan-orgspace/references/authentication.md`
- Create: `skill/tashan-orgspace/references/safety.md`
- Move: `skill/capability-references.json` to `skill/tashan-orgspace/capability-references.json`
- Modify: `scripts/check-capability-coverage.mjs`
- Modify: `README.md`

- [ ] **Step 1: Move the capability reference and make the coverage gate fail**

Move the file without updating the gate, then run `node scripts/check-capability-coverage.mjs`.

Expected: FAIL because the old path is absent.

- [ ] **Step 2: Write concise Skill instructions and references**

The Skill must install/check `torg`, explain the next-turn discovery rule, use hidden password/code input, use machine-readable JSON, preserve CLI confirmations, dynamically inspect capabilities, and explicitly reject unsupported Windows installation. It must never ask an agent to inspect credential-store contents or echo secrets.

- [ ] **Step 3: Update the gate and validate the Skill**

Update only the coverage reader path. Run the system Skill validator against `skill/tashan-orgspace`, then run capability coverage and release contract gates.

- [ ] **Step 4: Commit**

Commit: `feat(skill): publish OrgSpace agent interface`

## Task 5: Add release CI and clean-user verification

**Files:**

- Create: `.github/workflows/release-cli.yml`
- Create: `scripts/test-fresh-user-install.sh`
- Create: `scripts/test-fresh-user-install.self-test.sh`
- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/verify-phase0.sh`
- Modify: `docs/architecture/phase0-security-foundation.md`

- [ ] **Step 1: Write the fresh-user negative self-test**

The self-test supplies a corrupt asset and expects the fresh-user runner to reject it while leaving HOME empty. It also checks that running the runner without an explicit local artifact is read-only and prints usage.

- [ ] **Step 2: Implement the clean-user runner**

Build an artifact, create temporary HOME/XDG paths, install from fixture release assets, remove development Node/pnpm from PATH, run `torg --version`, no-argument help and `capability list --json` against a bounded loopback fixture API, then reinstall and confirm idempotency. Always clean temporary homes and processes.

- [ ] **Step 3: Add the tag release workflow**

On `v*` tags, require tag equals manifest version, run the full verifier, build each supported platform on its native GitHub runner, aggregate assets, generate `SHA256SUMS`, and publish through `gh release create`. Versions containing `-` are prereleases. Stable versions must first receive a valid success response from `https://orgspace.tashan.chat/v1/health`.

- [ ] **Step 4: Wire and verify**

Run:

```bash
bash scripts/test-fresh-user-install.self-test.sh
bash scripts/test-fresh-user-install.sh --local-build
bash scripts/verify-phase0.sh
```

Expected: all pass; no production host is contacted by local tests.

- [ ] **Step 5: Commit**

Commit: `ci(release): verify fresh-user CLI installation`

## Task 6: Publish the public repository and prerelease

**Files:**

- Modify: Git remote configuration
- External: `TashanGKD/tashan-orgspace`
- External: GitHub prerelease `v0.1.0-alpha.1`

- [ ] **Step 1: Perform the public-source safety audit**

Run tracked-file secret scans, confirm `.env.example` contains only empty values/loopback defaults, inspect `git diff main...HEAD`, and run the complete verifier. Stop if any real credential, member phone, local volume or machine-specific path is tracked.

- [ ] **Step 2: Create the public GitHub repository and push**

Create `TashanGKD/tashan-orgspace` as public with no generated README, set it as `origin`, fast-forward local `main` to the verified implementation branch, and push `main`. Verify the Skill URL returns its actual `SKILL.md` through GitHub.

- [ ] **Step 3: Tag and monitor the prerelease**

Create annotated tag `v0.1.0-alpha.1`, push it, wait for the release workflow, inspect every job, and verify all three assets plus `SHA256SUMS` are publicly downloadable. Do not mark it stable because production health has not been proven.

- [ ] **Step 4: Commit any evidence-only plan updates**

Commit: `docs(plan): record distribution execution`

## Task 7: Independent brand-new-user audit

**Files:**

- Create: `docs/verification/skill-cli-fresh-user-audit.md`

- [ ] **Step 1: Dispatch a test-only subagent**

Give the subagent only the public Skill URL, a temporary installation destination, and the user scenario. It must not edit product code. It installs through the standard Skill installer, reads the installed Skill, lets the Skill install `torg`, starts its own bounded loopback capability fixture, and records commands/exit codes with secrets excluded.

- [ ] **Step 2: Require realistic failure checks**

The subagent must test clean install, repeat install, no-argument behavior, help, version, JSON capability call, unsupported platform, checksum corruption and unmanaged-target refusal.

- [ ] **Step 3: Root-agent independent verification**

Inspect the subagent's filesystem evidence rather than trusting its summary. Repeat the public download/install smoke in a separate temporary HOME. Compare the installed Skill version, release checksum and CLI version to the repository manifest.

- [ ] **Step 4: Record and commit the audit**

Write exact public URLs, release/tag SHA, asset checksums, test results, any limitations, and the distinction between installation readiness and production-login readiness.

Commit: `docs(verify): record fresh-user distribution audit`

## Plan self-review result

- **Spec coverage:** public Skill, self-contained CLI, pinned version, secure installation, upgrade/rollback, CI release, public publishing and independent fresh-user audit each map to a task.
- **Security order:** traversal, platform, checksum, archive, unmanaged-target and cleanup failures are tests before installer implementation.
- **Safe defaults:** all no-argument scripts are read-only; release is tag-triggered; stable release is production-health gated; tests cannot silently redirect production downloads.
- **Drift prevention:** release metadata, CLI version, Skill version, platform assets and tag are machine-compared, not maintained by prose.
- **Scope:** AUP production deployment and SMS-backed public registration remain separate from this distribution plan; the prerelease must state that production login is not yet accepted.
