import { randomUUID } from "node:crypto";

import type { TransactionClient } from "../db/transaction.js";
import { DEFAULT_PERSONAL_QUOTA_BYTES, ORGANIZATION_QUOTA_BYTES } from "./constants.js";

async function insertRoot(
  transaction: TransactionClient,
  input: { spaceId: string; rootId: string; accountId: string },
): Promise<void> {
  await transaction`
    insert into file_entries (
      id, space_id, kind, name, normalized_name, created_by_account_id
    ) values (${input.rootId}, ${input.spaceId}, 'folder', '.root', '.root', ${input.accountId})
  `;
}

export async function createPersonalSpace(
  transaction: TransactionClient,
  accountId: string,
): Promise<{ id: string; rootFolderId: string }> {
  const spaceId = randomUUID();
  const rootFolderId = randomUUID();
  await transaction`
    insert into spaces (id, type, account_id, quota_bytes, root_folder_id)
    values (
      ${spaceId}, 'personal', ${accountId}, ${DEFAULT_PERSONAL_QUOTA_BYTES.toString()}, ${rootFolderId}
    )
  `;
  await insertRoot(transaction, { spaceId, rootId: rootFolderId, accountId });
  return { id: spaceId, rootFolderId };
}

export async function createOrganizationSpace(
  transaction: TransactionClient,
  organizationId: string,
  ownerAccountId: string,
): Promise<{ id: string; rootFolderId: string }> {
  const spaceId = randomUUID();
  const rootFolderId = randomUUID();
  await transaction`
    insert into spaces (id, type, organization_id, quota_bytes, root_folder_id)
    values (
      ${spaceId}, 'organization', ${organizationId}, ${ORGANIZATION_QUOTA_BYTES.toString()},
      ${rootFolderId}
    )
  `;
  await insertRoot(transaction, { spaceId, rootId: rootFolderId, accountId: ownerAccountId });
  await transaction`
    insert into folder_access_policies (folder_id, scope, updated_by_account_id)
    values (${rootFolderId}, 'organization_public', ${ownerAccountId})
  `;
  return { id: spaceId, rootFolderId };
}
