# Notifications

Use the signed-in user's token. Read IDs from list output; never guess an organization or notification ID.

```bash
torg --invocation-source ai_via_cli --json notification list --org <organization-id>
torg --invocation-source ai_via_cli --json notification get --org <organization-id> --notification <notification-id>
torg --invocation-source ai_via_cli --json notification mark-read --org <organization-id> --notification <notification-id> --idempotency-key <unique-key>
```

Only the daily SMS summary can be disabled by a member. Approval requests, emergencies, deadline and meeting reminders, and partner follow-ups remain enabled.

```bash
torg --invocation-source ai_via_cli --json notification preference-get --org <organization-id>
torg --invocation-source ai_via_cli --json notification preference-set --org <organization-id> --daily-summary off --yes --idempotency-key <unique-key>
```

Organization owners and administrators can read the current immutable policy version and publish a new timezone version:

```bash
torg --invocation-source ai_via_cli --json notification policy-get --org <organization-id>
torg --invocation-source ai_via_cli --json notification policy-publish --org <organization-id> --timezone Asia/Shanghai --expected-version <version> --yes --idempotency-key <unique-key>
```

Publishing does not make mandatory notification classes optional. A version conflict means the policy changed; read it again before publishing.
