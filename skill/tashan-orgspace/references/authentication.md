# Authentication

## Login

Run the interactive command in a terminal so the CLI, rather than the agent, receives the password:

```bash
torg --invocation-source ai_via_cli --json auth login --username <username>
```

Do not add a `--password` option; the CLI rejects it. Use `--password-stdin` only when the user explicitly controls a private, non-logged input pipe. Never construct that pipe in an agent-visible command.

After login, verify identity with:

```bash
torg --invocation-source ai_via_cli --json auth whoami
```

The CLI stores session tokens in the operating-system credential store when available. An explicit encrypted credential file is an advanced fallback; do not inspect, print, copy, or decode it.

## Registration and phone verification

Registration and phone verification are separate server capabilities. First inspect them with `capability describe`. Use opaque idempotency keys and hidden prompts:

```bash
torg --invocation-source ai_via_cli --json auth register --username <username> --idempotency-key <key>
torg --invocation-source ai_via_cli --json auth phone-start --phone <e164> --idempotency-key <key>
torg --invocation-source ai_via_cli --json auth phone-confirm --challenge <challenge-id> --idempotency-key <key>
```

Phone numbers are sensitive personal data. Show only the minimum necessary in summaries.

## Devices and logout

One person has one member identity. Multiple computers use separate device sessions. List server-issued IDs before revoking anything. Revoking the current device requires the explicit `--allow-current-device` flag as well as `--yes`.

Logout clears the local session only after the server operation succeeds:

```bash
torg --invocation-source ai_via_cli --json auth logout --yes
```
