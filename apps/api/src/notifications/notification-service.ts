import { NotificationListQuery, NotificationRecord } from "@tashan/contracts";
import { AuthError } from "../auth/auth-errors.js";
import type { TransactionClient } from "../db/transaction.js";
import { requireOrganizationMembership } from "../organizations/authorization.js";

interface NotificationRow {
  id: string;
  organization_id: string;
  recipient_account_id: string;
  event_type: string;
  title: string;
  body: string;
  resource_type: string | null;
  resource_id: string | null;
  status: "unread" | "read";
  created_at: Date;
  read_at: Date | null;
}

function publicRow(row: NotificationRow) {
  return NotificationRecord.parse({
    id: row.id,
    organizationId: row.organization_id,
    recipientAccountId: row.recipient_account_id,
    eventType: row.event_type,
    title: row.title,
    body: row.body,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    readAt: row.read_at?.toISOString() ?? null,
  });
}

export class NotificationService {
  public async list(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    raw: unknown,
  ) {
    const input = NotificationListQuery.parse(raw);
    await requireOrganizationMembership(tx, accountId, organizationId);
    const rows = await tx<NotificationRow[]>`
      select * from notifications
      where organization_id=${organizationId}
        and recipient_account_id=${accountId}
        and (${input.status ?? null}::text is null or status=${input.status ?? null})
      order by created_at desc,id desc
      limit ${input.limit}
    `;
    return { items: rows.map(publicRow), nextCursor: null };
  }

  public async read(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    notificationId: string,
  ) {
    await requireOrganizationMembership(tx, accountId, organizationId);
    const [row] = await tx<NotificationRow[]>`
      select * from notifications
      where id=${notificationId} and organization_id=${organizationId} and recipient_account_id=${accountId}
    `;
    if (!row) throw new AuthError("NOTIFICATION_NOT_FOUND", "notification was not found");
    return publicRow(row);
  }

  public async markRead(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    notificationId: string,
  ) {
    await requireOrganizationMembership(tx, accountId, organizationId);
    const [row] = await tx<NotificationRow[]>`
      update notifications set status='read',read_at=coalesce(read_at,now())
      where id=${notificationId} and organization_id=${organizationId} and recipient_account_id=${accountId}
      returning *
    `;
    if (!row) throw new AuthError("NOTIFICATION_NOT_FOUND", "notification was not found");
    return publicRow(row);
  }
}
