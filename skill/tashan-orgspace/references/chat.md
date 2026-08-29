# Chat

Chat is organization-scoped. A direct conversation requires both people to be active members of the selected organization. Group history is visible only to active conversation members; do not use random IDs to probe conversations.

```bash
torg --invocation-source ai_via_cli --json chat conversation list --org <organization-id>
torg --invocation-source ai_via_cli --json chat conversation direct-create --org <organization-id> --account <account-id> --yes --idempotency-key <unique-key>
torg --invocation-source ai_via_cli --json chat conversation group-create --org <organization-id> --title <title> --member <account-id...> --yes --idempotency-key <unique-key>
```

Messages use a client message ID and a separate request idempotency key. Reuse both only when retrying the exact same send.

```bash
torg --invocation-source ai_via_cli --json chat message list --org <organization-id> --conversation <conversation-id>
torg --invocation-source ai_via_cli --json chat message send --org <organization-id> --conversation <conversation-id> --body <text> --client-message-id <uuid> --idempotency-key <unique-key>
torg --invocation-source ai_via_cli --json chat message retract --org <organization-id> --conversation <conversation-id> --message <message-id> --yes --idempotency-key <unique-key>
torg --invocation-source ai_via_cli --json chat event list --org <organization-id> --conversation <conversation-id> --after <server-sequence>
torg --invocation-source ai_via_cli --json chat event stream --org <organization-id> --conversation <conversation-id> --after <server-sequence>
torg --invocation-source ai_via_cli --json chat event stream --org <organization-id> --conversation <conversation-id> --after <server-sequence> --once
```

An edited or retracted message remains represented by append-only events. Never claim that withdrawal erases compliance history.

Messages can be converted into tasks, meetings or approvals with an explicit confirmation and idempotency key. File attachments are accepted only when every current conversation member can read the file.

Organization owners may create a reasoned, time-bounded compliance review. This is a high-risk action; do not run it for ordinary members or expand the requested time window.
