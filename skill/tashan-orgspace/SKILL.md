---
name: tashan-orgspace
description: Install and use the Tashan OrgSpace torg CLI for account, device, organization, capability, and audit operations. Use when a user asks Codex or another agent to work with Tashan OrgSpace, organization accounts, or the torg command.
---

# Tashan OrgSpace

Use the bundled installer and the `torg` CLI. Do not reimplement API calls.

## Bootstrap the CLI

Resolve paths relative to this `SKILL.md` file.

1. On Windows, stop and explain that this release supports macOS arm64/x64 and Linux x64 only.
2. Run `sh scripts/install-cli.sh --check` from this Skill directory.
3. If the check says this installer has not installed `torg`, tell the user that the Skill will install a pinned, checksum-verified CLI in their user directory, then run `sh scripts/install-cli.sh --install`.
4. Never run the installer with `sudo`, copy it into a shell startup file, or set its test-only environment variables.
5. If installation succeeds but `torg` is not on `PATH`, invoke `$HOME/.local/bin/torg` and tell the user to add `$HOME/.local/bin` to `PATH` later.

An installed or updated Skill is discovered by Codex on the next turn. Do not claim it was active earlier in the same turn.

## Establish the server contract

For agent-driven calls, include `--invocation-source ai_via_cli` and prefer `--json`:

```bash
torg --invocation-source ai_via_cli --json health
torg --invocation-source ai_via_cli --json capability list
torg --invocation-source ai_via_cli --json capability describe <capability-id>
```

Inspect live capabilities before using a feature; the bundled capability list is a coverage gate, not proof that the production server is currently reachable. If health or discovery fails, report that fact and stop rather than inventing support.

## Authenticate safely

Read [authentication.md](references/authentication.md) before registering, logging in, verifying a phone, or changing devices. Let `torg` collect passwords and verification codes through its hidden interactive prompt. Never place a password, code, access token, refresh token, or credential-file passphrase in arguments, environment variables, chat, logs, or command output.

Use the login token stored by the CLI as the real user and device identity. Do not create subaccounts to represent additional computers.

## Execute commands

- Start with `<command> --help` when flags or targets are uncertain.
- Read with `--json` and use the returned IDs exactly; do not guess organization, account, device, cursor, or capability IDs.
- Preserve CLI confirmation gates. Add `--yes` only after the user has explicitly requested the mutation and you have summarized its exact target.
- Supply a fresh opaque `--idempotency-key` for mutating commands that accept it. Reuse that key only to retry the same intended mutation.
- Do not bypass authorization or reach into credential storage. See [safety.md](references/safety.md).

Examples:

```bash
torg --invocation-source ai_via_cli --json auth whoami
torg --invocation-source ai_via_cli --json org list
torg --invocation-source ai_via_cli --json org member list --org <org-id>
torg --invocation-source ai_via_cli --json device list
torg --invocation-source ai_via_cli --json audit list --limit 25
```

The prerelease currently covers authentication, device sessions, organizations, capability discovery, and audit reads. Files, OKR/tasks, approvals, chat, remote execution, services, databases, domains, SMS delivery, and AI employees remain planned capabilities unless the live capability endpoint says otherwise.

## Respond

Report the command outcome, affected resource IDs, and any server error code without exposing secrets. Distinguish CLI installation success from production service readiness.
