# OKR

Read current IDs and versions with JSON output. Progress updates take effect immediately. Title, cycle, formula and weight changes are substantive and require an administrator-approved change request unless an administrator performs an explicit audited edit.

```bash
torg okr list --org <organization-id>
torg okr get --org <organization-id> --objective <objective-id>
torg okr create --org <organization-id> --title <title> --cycle <cycle> --key-results <json> --yes --idempotency-key <fresh-key>
torg okr progress --org <organization-id> --key-result <key-result-id> --value <number> --expected-version <n> --yes --idempotency-key <fresh-key>
torg okr change-request --org <organization-id> --objective <objective-id> --patch <json> --expected-version <n> --yes --idempotency-key <fresh-key>
torg okr approve --org <organization-id> --change-request <id> --expected-version <n> --yes --idempotency-key <fresh-key>
torg okr admin-edit --org <organization-id> --objective <objective-id> --patch <json> --expected-version <n> --yes --idempotency-key <fresh-key>
```

For numeric formulas, `--value` is the current measurement, not a precomputed percentage. For manual formulas it is the percentage. Linked-task progress is recomputed from authorized task state. Never link work from another organization.
