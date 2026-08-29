# Spaces and files

Read IDs with `--json`; never guess a space, folder, file, upload, version, account, or organization ID.

## Find a space and browse files

```bash
torg space list
torg space get --space <space-id>
torg space usage --space <space-id>
torg file list --space <space-id> --parent <folder-id>
torg file get --space <space-id> --file <entry-id>
torg file search --space <space-id> --query <text>
```

An organization administrator can change a member's personal quota with `torg space quota-set`; show the organization, account and byte limit before adding `--yes`.

## Upload and download

Start a new file with:

```bash
torg file upload <local-path> --space <space-id> --parent <folder-id> \
  --idempotency-key <fresh-key>
```

To add a version, use the same command with `--target-file <file-id>`. A same-name upload without `--target-file` fails instead of silently overwriting.

Use `torg upload list` to find unfinished uploads, `torg upload resume <local-path>` with the server upload ID to continue one, and `torg upload cancel` with `--yes` to cancel one. Resume trusts the server-confirmed part list and checks each confirmed part against the local bytes.

Download through:

```bash
torg file download --space <space-id> --file <file-id> \
  --output <local-path> --idempotency-key <fresh-key>
```

The CLI writes a temporary sibling, verifies SHA-256, then atomically publishes it only if the destination does not already exist. Never call MinIO or S3 directly. Never print or reuse presigned URLs.

## Folders, versions and trash

```bash
torg file mkdir --space <space-id> --parent <folder-id> --name <name> \
  --access <organization_public|restricted> --idempotency-key <fresh-key>
torg file move --space <space-id> --file <entry-id> --parent <folder-id> \
  --expected-version <n> --idempotency-key <fresh-key>
torg file versions --space <space-id> --file <file-id>
torg file version-restore --space <space-id> --file <file-id> --version-id <version-id> \
  --expected-version <n> --yes --idempotency-key <fresh-key>
torg file trash --space <space-id> --file <entry-id> --yes --idempotency-key <fresh-key>
torg file restore --space <space-id> --file <entry-id> --expected-version <n> \
  --idempotency-key <fresh-key>
torg file delete --space <space-id> --file <entry-id> --yes \
  --idempotency-key <fresh-key>
```

`torg file delete` schedules permanent deletion of the entry and all versions. State that consequence before adding `--yes`.

Read access with `torg folder get-access`. Change the public scope with `torg folder access`, add or update a role with `torg folder grant`, and remove one with `torg folder revoke`. All three mutations require the current policy version where requested, a fresh idempotency key and `--yes`. Organization administrators use `torg folder manager-recover` only when manager recovery is explicitly requested and a reason has been provided.
