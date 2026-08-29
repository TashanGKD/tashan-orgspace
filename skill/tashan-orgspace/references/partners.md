# Partner contacts

Members may access only contacts they own. Organization administrators must pass explicit all-owner scope. Never probe other owners through IDs, search, counts or duplicate checks. Full contacts and exports are sensitive.

```bash
torg partner list --org <org-id>
torg partner list --org <org-id> --owner all --admin-scope
torg partner get --org <org-id> --partner <id>
torg partner create --org <org-id> --data <json> --yes --idempotency-key <key>
torg partner update --org <org-id> --partner <id> --patch <json> --expected-version <n> --yes --idempotency-key <key>
torg partner archive|restore|transfer ...
torg partner interaction list|add|correct ...
torg partner link|unlink ...
torg partner export --org <org-id> --owner all --output <path> --yes --idempotency-key <key>
```

Export refuses an existing destination and creates a `0600` file. Do not paste bulk full contacts into chat. Show export scope and sensitivity before confirmation.
