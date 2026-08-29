import { randomUUID } from "node:crypto";

import {
  WorkItemCreateRequest,
  WorkItemListQuery,
  WorkItemTransitionRequest,
} from "@tashan/contracts";

import { AuthError } from "../auth/auth-errors.js";
import { CollaborationRepository } from "../collaboration/collaboration-repository.js";
import type { TransactionClient } from "../db/transaction.js";
import { requireOrganizationMembership } from "../organizations/authorization.js";

interface WorkRow {
  id: string;
  organization_id: string;
  type: "task" | "meeting" | "approval" | "change_request";
  title: string;
  description: string;
  priority: "normal" | "urgent";
  status: "open" | "completed" | "cancelled";
  due_at: Date | null;
  meeting_starts_at: Date | null;
  created_by_account_id: string;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface AssignmentRow {
  id: string;
  assignee_account_id: string;
  assigned_by_account_id: string;
  status: "assigned" | "disputed" | "transfer_pending";
  dispute_reason: string | null;
  transfer_target_account_id: string | null;
  transfer_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

function item(row: WorkRow) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    type: row.type,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    dueAt: row.due_at?.toISOString() ?? null,
    meetingStartsAt: row.meeting_starts_at?.toISOString() ?? null,
    createdByAccountId: row.created_by_account_id,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function assignment(row: AssignmentRow) {
  return {
    id: row.id,
    assigneeAccountId: row.assignee_account_id,
    assignedByAccountId: row.assigned_by_account_id,
    status: row.status,
    disputeReason: row.dispute_reason,
    transferTargetAccountId: row.transfer_target_account_id,
    transferReason: row.transfer_reason,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class WorkService {
  private readonly collaboration = new CollaborationRepository();

  private async state(transaction: TransactionClient, workItemId: string) {
    const [row] = await transaction<WorkRow[]>`select * from work_items where id = ${workItemId}`;
    if (row === undefined) throw new AuthError("WORK_NOT_FOUND", "work item not found");
    const assignments = await transaction<AssignmentRow[]>`
      select * from work_assignments where work_item_id = ${workItemId} order by created_at, id
    `;
    return { item: item(row), assignments: assignments.map(assignment) };
  }

  public async list(
    transaction: TransactionClient,
    accountId: string,
    organizationId: string,
    raw: unknown,
  ) {
    const input = WorkItemListQuery.parse(raw);
    await requireOrganizationMembership(transaction, accountId, organizationId);
    const type = input.type ?? null;
    const status = input.status ?? null;
    const assigneeId = input.assigneeAccountId ?? null;
    const rows = await transaction<WorkRow[]>`
      select item.* from work_items item
      where item.organization_id = ${organizationId}
        and (${type}::text is null or item.type = ${type})
        and (${status}::text is null or item.status = ${status})
        and (${assigneeId}::uuid is null or exists(
          select 1 from work_assignments assignment
          where assignment.work_item_id = item.id
            and assignment.assignee_account_id = ${assigneeId}
        ))
      order by item.due_at nulls last, item.created_at desc, item.id
      limit ${input.limit}
    `;
    return rows.map(item);
  }

  public async read(
    transaction: TransactionClient,
    accountId: string,
    organizationId: string,
    workItemId: string,
  ) {
    await requireOrganizationMembership(transaction, accountId, organizationId);
    const result = await this.state(transaction, workItemId);
    if (result.item.organizationId !== organizationId) {
      throw new AuthError("WORK_NOT_FOUND", "work item not found");
    }
    return result;
  }

  private async requireActiveTarget(
    transaction: TransactionClient,
    organizationId: string,
    accountId: string,
  ) {
    await requireOrganizationMembership(transaction, accountId, organizationId);
  }

  public async create(
    transaction: TransactionClient,
    accountId: string,
    organizationId: string,
    raw: unknown,
  ) {
    const input = WorkItemCreateRequest.parse(raw);
    await requireOrganizationMembership(transaction, accountId, organizationId);
    for (const targetId of input.assigneeAccountIds) {
      await this.requireActiveTarget(transaction, organizationId, targetId);
    }
    const workItemId = randomUUID();
    await transaction`
      insert into work_items (
        id, organization_id, type, title, description, priority, due_at,
        meeting_starts_at, created_by_account_id
      ) values (
        ${workItemId}, ${organizationId}, ${input.type}, ${input.title}, ${input.description},
        ${input.priority}, ${input.dueAt ?? null}, ${input.meetingStartsAt ?? null}, ${accountId}
      )
    `;
    for (const assigneeId of input.assigneeAccountIds) {
      await transaction`
        insert into work_assignments (
          work_item_id, assignee_account_id, assigned_by_account_id
        ) values (${workItemId}, ${assigneeId}, ${accountId})
      `;
    }
    const aggregate = {
      organizationId,
      resourceType: "work_item" as const,
      resourceId: workItemId,
    };
    await this.collaboration.registerResource(transaction, aggregate);
    await this.collaboration.appendDomainEvent(transaction, {
      accountId,
      aggregate,
      sequence: 1,
      eventType: "work.created",
      schemaVersion: 1,
      payload: {
        type: input.type,
        priority: input.priority,
        assigneeAccountIds: input.assigneeAccountIds,
      },
    });
    return this.state(transaction, workItemId);
  }

  public async transition(
    transaction: TransactionClient,
    accountId: string,
    workItemId: string,
    raw: unknown,
  ) {
    const input = WorkItemTransitionRequest.parse(raw);
    const [current] = await transaction<WorkRow[]>`
      select * from work_items where id = ${workItemId} for update
    `;
    if (current === undefined) throw new AuthError("WORK_NOT_FOUND", "work item not found");
    const membership = await requireOrganizationMembership(
      transaction,
      accountId,
      current.organization_id,
    );
    if (current.version !== input.expectedVersion) {
      throw new AuthError("WORK_VERSION_CONFLICT", "work item changed");
    }
    const admin = membership.role === "org_owner" || membership.role === "org_admin";
    const creator = current.created_by_account_id === accountId;
    let eventPayload: Record<string, unknown> = { action: input.action };

    if (input.action === "assign") {
      if (current.status !== "open") this.invalid();
      await this.requireActiveTarget(transaction, current.organization_id, input.accountId);
      try {
        await transaction`
          insert into work_assignments (work_item_id, assignee_account_id, assigned_by_account_id)
          values (${workItemId}, ${input.accountId}, ${accountId})
        `;
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "constraint_name" in error &&
          error.constraint_name === "work_assignments_work_item_id_assignee_account_id_key"
        ) {
          throw new AuthError("WORK_TRANSITION_INVALID", "account is already assigned");
        }
        throw error;
      }
      eventPayload = { ...eventPayload, accountId: input.accountId };
    } else if (
      input.action === "dispute" ||
      input.action === "request_transfer" ||
      input.action === "approve_transfer"
    ) {
      const [assigned] = await transaction<AssignmentRow[]>`
        select * from work_assignments where id = ${input.assignmentId}
          and work_item_id = ${workItemId} for update
      `;
      if (assigned === undefined) {
        throw new AuthError("ASSIGNMENT_NOT_FOUND", "assignment not found");
      }
      if (input.action === "dispute") {
        if (assigned.assignee_account_id !== accountId || current.status !== "open")
          this.forbidden();
        await transaction`
          update work_assignments set status = 'disputed', dispute_reason = ${input.reason},
            transfer_target_account_id = null, transfer_reason = null, updated_at = now()
          where id = ${assigned.id}
        `;
        eventPayload = { ...eventPayload, assignmentId: assigned.id, reason: input.reason };
      } else if (input.action === "request_transfer") {
        if (assigned.assignee_account_id !== accountId || current.status !== "open")
          this.forbidden();
        await this.requireActiveTarget(transaction, current.organization_id, input.targetAccountId);
        if (input.targetAccountId === accountId) this.invalid();
        await transaction`
          update work_assignments set status = 'transfer_pending', dispute_reason = null,
            transfer_target_account_id = ${input.targetAccountId}, transfer_reason = ${input.reason},
            updated_at = now() where id = ${assigned.id}
        `;
        eventPayload = {
          ...eventPayload,
          assignmentId: assigned.id,
          targetAccountId: input.targetAccountId,
          reason: input.reason,
        };
      } else {
        if ((!admin && !creator) || assigned.status !== "transfer_pending") this.forbidden();
        const targetId = assigned.transfer_target_account_id;
        if (targetId === null) this.invalid();
        await this.requireActiveTarget(transaction, current.organization_id, targetId);
        await transaction`
          update work_assignments set assignee_account_id = ${targetId}, status = 'assigned',
            dispute_reason = null, transfer_target_account_id = null, transfer_reason = null,
            assigned_by_account_id = ${accountId}, updated_at = now() where id = ${assigned.id}
        `;
        eventPayload = { ...eventPayload, assignmentId: assigned.id, accountId: targetId };
      }
    } else if (input.action === "complete") {
      const [assigned] = await transaction<{ exists: boolean }[]>`
        select exists(select 1 from work_assignments
          where work_item_id = ${workItemId} and assignee_account_id = ${accountId}) as exists
      `;
      if (current.status !== "open" || (!admin && !creator && assigned?.exists !== true)) {
        this.forbidden();
      }
      await transaction`
        update work_items set status = 'completed', completed_at = now(), cancelled_at = null,
          updated_at = now() where id = ${workItemId}
      `;
    } else if (input.action === "reopen") {
      if (current.status !== "completed" || (!admin && !creator)) this.forbidden();
      await transaction`
        update work_items set status = 'open', completed_at = null, cancelled_at = null,
          updated_at = now() where id = ${workItemId}
      `;
    } else {
      if (current.status !== "open" || (!admin && !creator)) this.forbidden();
      await transaction`
        update work_items set status = 'cancelled', completed_at = null, cancelled_at = now(),
          updated_at = now() where id = ${workItemId}
      `;
    }

    const nextVersion = current.version + 1;
    await transaction`
      update work_items set version = ${nextVersion}, updated_at = now() where id = ${workItemId}
    `;
    await this.collaboration.appendDomainEvent(transaction, {
      accountId,
      aggregate: {
        organizationId: current.organization_id,
        resourceType: "work_item",
        resourceId: workItemId,
      },
      sequence: nextVersion,
      eventType: `work.${input.action}`,
      schemaVersion: 1,
      payload: eventPayload,
    });
    return this.state(transaction, workItemId);
  }

  private forbidden(): never {
    throw new AuthError("WORK_FORBIDDEN", "work transition is forbidden");
  }

  private invalid(): never {
    throw new AuthError("WORK_TRANSITION_INVALID", "work transition is invalid");
  }
}
