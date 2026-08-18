# Safety boundaries

- Treat usernames, phone numbers, device metadata, IP-derived audit data, organization membership, tokens, verification codes, and audit events as sensitive.
- Never read or expose Keychain, Secret Service, encrypted credential-file, or raw token contents. Use only documented `torg` commands.
- Never put secrets in command arguments, URLs, environment variables, shell history, logs, chat, or JSON output.
- Use server-returned identifiers. Reject guessed IDs and ambiguous targets.
- Do not add `--yes` merely to make a command pass. It records that the caller intentionally crossed a mutation gate.
- Do not weaken TLS, substitute a different API origin, or use installer test overrides in normal operation.
- The CLI enforces platform authorization; the agent must not attempt filesystem, process, container, service, database, or organization-boundary bypasses.
- Public network access by a workload does not imply public access to its files, credentials, organization data, or service. Future service publication must remain an explicit authenticated operation.
- If the live server lacks a capability, state that it is unavailable. Do not emulate it with SSH, raw HTTP, local filesystem access, or another project.
