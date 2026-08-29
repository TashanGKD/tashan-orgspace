# Search

Search always runs in one explicit organization and returns only references the signed-in account can currently access.

```bash
torg --invocation-source ai_via_cli --json search query --org <organization-id> --text <query>
torg --invocation-source ai_via_cli --json search query --org <organization-id> --text <query> --type file work_item objective partner member message
```

The result count is the number of authorized hits returned, not the number of all matching records. Do not infer hidden files, other members' Partner records or conversations from missing groups or counts. Retracted messages are excluded from ordinary search; compliance access is a separate owner-only workflow.
