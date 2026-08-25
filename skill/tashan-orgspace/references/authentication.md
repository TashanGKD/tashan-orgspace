# Authentication

## Login

Run the interactive command in a terminal so the CLI, rather than the agent, receives the password:

```bash
torg --invocation-source ai_via_cli --json auth login --phone <phone>
```

Do not add a `--password` option; the CLI rejects it. Use `--password-stdin` only when the user explicitly controls a private, non-logged input pipe. Never construct that pipe in an agent-visible command.

After login, verify identity with:

```bash
torg --invocation-source ai_via_cli --json auth whoami
```

The CLI stores session tokens in the operating-system credential store when available. An explicit encrypted credential file is an advanced fallback; do not inspect, print, copy, or decode it.

## Registration

Request a purpose-bound verification challenge, then register with that challenge. Both the verification code and password are collected by hidden prompts:

```bash
torg --invocation-source ai_via_cli --json auth code-send --phone <phone> --purpose register --idempotency-key <key>
torg --invocation-source ai_via_cli --json auth register --phone <phone> --challenge <challenge-id> --idempotency-key <key>
```

Phone numbers are sensitive personal data. Show only the minimum necessary in summaries.

## Password reset

Password reset uses a separate purpose-bound challenge. It revokes every old device session after the verification code and new password are accepted. The destructive session revocation requires `--yes`:

```bash
torg --invocation-source ai_via_cli --json auth code-send --phone <phone> --purpose password-reset --idempotency-key <key>
torg --invocation-source ai_via_cli --json auth password-reset --phone <phone> --challenge <challenge-id> --idempotency-key <key> --yes
```

After reset, log in again on each intended device. Do not use a subaccount to represent another computer.

## Devices and logout

One person has one member identity. Multiple computers use separate device sessions. List server-issued IDs before revoking anything. Revoking the current device requires the explicit `--allow-current-device` flag as well as `--yes`.

Logout clears the local session only after the server operation succeeds:

```bash
torg --invocation-source ai_via_cli --json auth logout --yes
```
