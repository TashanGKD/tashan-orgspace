import { ChatComplianceReview, ChatComplianceReviewRequest } from "@tashan/contracts";
import { AuthError } from "../auth/auth-errors.js";
import type { TransactionClient } from "../db/transaction.js";
import { requireOrganizationMembership } from "../organizations/authorization.js";

interface ReviewRow {
  id: string;
  organization_id: string;
  conversation_id: string;
  requested_by_account_id: string;
  reason: string;
  starts_at: Date;
  ends_at: Date;
  created_at: Date;
}
function publicReview(row: ReviewRow) {
  return ChatComplianceReview.parse({
    id: row.id,
    organizationId: row.organization_id,
    conversationId: row.conversation_id,
    requestedByAccountId: row.requested_by_account_id,
    reason: row.reason,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  });
}
export class ComplianceService {
  private async owner(tx: TransactionClient, accountId: string, organizationId: string) {
    try {
      await requireOrganizationMembership(tx, accountId, organizationId, ["org_owner"]);
    } catch (error) {
      if (error instanceof AuthError)
        throw new AuthError("CHAT_FORBIDDEN", "compliance review is unavailable");
      throw error;
    }
  }
  public async createReview(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    raw: unknown,
  ) {
    const input = ChatComplianceReviewRequest.parse(raw);
    await this.owner(tx, accountId, organizationId);
    const [conversation] = await tx<{ id: string }[]>`
      select id from conversations where id=${input.conversationId} and organization_id=${organizationId}
    `;
    if (!conversation) throw new AuthError("CHAT_NOT_FOUND", "conversation was not found");
    const [row] = await tx<ReviewRow[]>`
      insert into chat_compliance_reviews(
        organization_id,conversation_id,requested_by_account_id,reason,starts_at,ends_at
      ) values(
        ${organizationId},${input.conversationId},${accountId},${input.reason},${input.startsAt},${input.endsAt}
      ) returning *
    `;
    if (!row) throw new Error("compliance review insert failed");
    return publicReview(row);
  }
  public async readReview(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    reviewId: string,
  ) {
    await this.owner(tx, accountId, organizationId);
    const [review] = await tx<ReviewRow[]>`
      select * from chat_compliance_reviews where id=${reviewId} and organization_id=${organizationId}
    `;
    if (!review) throw new AuthError("CHAT_NOT_FOUND", "compliance review was not found");
    const rows = await tx<
      {
        id: string;
        sequence: number | string;
        event_type:
          | "message.sent"
          | "message.edited"
          | "message.retracted"
          | "reaction.added"
          | "reaction.removed";
        message_id: string;
        actor_account_id: string;
        body: string | null;
        created_at: Date;
      }[]
    >`
      select id,sequence,event_type,message_id,actor_account_id,
        case when event_type in('message.sent','message.edited') then payload->>'body' else null end body,
        created_at
      from chat_events where conversation_id=${review.conversation_id}
        and created_at>=${review.starts_at} and created_at<${review.ends_at}
      order by sequence,id
    `;
    return {
      review: publicReview(review),
      events: rows.map((row) => ({
        id: row.id,
        sequence: Number(row.sequence),
        eventType: row.event_type,
        messageId: row.message_id,
        actorAccountId: row.actor_account_id,
        body: row.body,
        createdAt: row.created_at.toISOString(),
      })),
    };
  }
}
