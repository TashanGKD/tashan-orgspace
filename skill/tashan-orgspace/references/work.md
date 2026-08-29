# Organization work and approvals

Read IDs and current `version` values with `--json`; never guess organization, work, assignment, definition, version or instance IDs.

```bash
torg work list --org <organization-id>
torg work get --org <organization-id> --work <work-item-id>
torg work create --org <organization-id> --type <task|meeting|approval|change_request> --title <title> --yes --idempotency-key <fresh-key>
torg work assign --org <organization-id> --work <work-item-id> --account <account-id> --expected-version <n> --yes --idempotency-key <fresh-key>
torg work dispute --org <organization-id> --work <work-item-id> --assignment <assignment-id> --reason <text> --expected-version <n> --yes --idempotency-key <fresh-key>
torg work transfer-request --org <organization-id> --work <work-item-id> --assignment <assignment-id> --target <account-id> --reason <text> --expected-version <n> --yes --idempotency-key <fresh-key>
torg work transfer-approve --org <organization-id> --work <work-item-id> --assignment <assignment-id> --expected-version <n> --yes --idempotency-key <fresh-key>
torg work complete --org <organization-id> --work <work-item-id> --expected-version <n> --yes --idempotency-key <fresh-key>
torg work reopen --org <organization-id> --work <work-item-id> --expected-version <n> --yes --idempotency-key <fresh-key>
torg work cancel --org <organization-id> --work <work-item-id> --expected-version <n> --yes --idempotency-key <fresh-key>
torg process definition-create --org <organization-id> --name <name> --mode <single|sequence|any|all> --approver <account-id...> --yes --idempotency-key <fresh-key>
torg process version-create --org <organization-id> --definition <definition-id> --mode <mode> --approver <account-id...> --expected-version <n> --yes --idempotency-key <fresh-key>
torg process version-publish --org <organization-id> --version-id <version-id> --yes --idempotency-key <fresh-key>
torg process start --org <organization-id> --version-id <version-id> --subject <json> --yes --idempotency-key <fresh-key>
torg process get --org <organization-id> --instance <instance-id>
torg process decide --org <organization-id> --instance <instance-id> --action <approve|reject|return|withdraw|transfer> --expected-version <n> --yes --idempotency-key <fresh-key>
```

`task create`, `meeting create` and `approval create` are typed aliases. Assignment takes effect immediately. Dispute and transfer request do not remove current responsibility. Published process versions are immutable. Re-read state after a version conflict.
