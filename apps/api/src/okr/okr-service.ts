import { randomUUID } from "node:crypto";
import type { JSONValue } from "postgres";

import {
  KeyResultFormula,
  ObjectiveCreateRequest,
  OkrChangeApprovalRequest,
  OkrChangeRequest,
  OkrProgressUpdateRequest,
  ObjectiveListQuery,
} from "@tashan/contracts";

import { AuthError } from "../auth/auth-errors.js";
import { CollaborationRepository } from "../collaboration/collaboration-repository.js";
import type { TransactionClient } from "../db/transaction.js";
import { requireOrganizationMembership } from "../organizations/authorization.js";
import { WorkService } from "../work/work-service.js";

interface ObjectiveRow {
  id: string;
  organization_id: string;
  owner_account_id: string;
  title: string;
  cycle: string;
  progress: string | number;
  version: number;
  created_at: Date;
  updated_at: Date;
}
interface KrRow {
  id: string;
  objective_id: string;
  title: string;
  weight: number;
  formula: unknown;
  formula_version: number;
  progress: string | number;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export class OkrService {
  private readonly collaboration = new CollaborationRepository();
  private readonly work = new WorkService();

  private objective(row: ObjectiveRow) {
    return {
      id: row.id,
      organizationId: row.organization_id,
      ownerAccountId: row.owner_account_id,
      title: row.title,
      cycle: row.cycle,
      progress: Number(row.progress),
      version: row.version,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
  private keyResult(row: KrRow) {
    return {
      id: row.id,
      objectiveId: row.objective_id,
      title: row.title,
      weight: row.weight,
      formula: KeyResultFormula.parse(row.formula),
      formulaVersion: row.formula_version,
      progress: Number(row.progress),
      version: row.version,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
  private async state(tx: TransactionClient, objectiveId: string) {
    const [objective] = await tx<
      ObjectiveRow[]
    >`select * from okr_objectives where id = ${objectiveId}`;
    if (objective === undefined) this.notFound();
    const keyResults = await tx<
      KrRow[]
    >`select * from okr_key_results where objective_id = ${objectiveId} order by created_at, id`;
    return {
      objective: this.objective(objective),
      keyResults: keyResults.map((row) => this.keyResult(row)),
    };
  }

  public async list(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    raw: unknown,
  ) {
    const input = ObjectiveListQuery.parse(raw);
    await requireOrganizationMembership(tx, accountId, organizationId);
    const cycle = input.cycle ?? null;
    const owner = input.ownerAccountId ?? null;
    const rows = await tx<ObjectiveRow[]>`
      select * from okr_objectives where organization_id = ${organizationId}
        and (${cycle}::text is null or cycle = ${cycle})
        and (${owner}::uuid is null or owner_account_id = ${owner})
      order by cycle desc, created_at desc, id limit ${input.limit}
    `;
    return rows.map((row) => this.objective(row));
  }

  public async read(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    objectiveId: string,
  ) {
    await requireOrganizationMembership(tx, accountId, organizationId);
    const result = await this.state(tx, objectiveId);
    if (result.objective.organizationId !== organizationId) this.notFound();
    return result;
  }

  public async createObjective(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    raw: unknown,
  ) {
    const input = ObjectiveCreateRequest.parse(raw);
    await requireOrganizationMembership(tx, accountId, organizationId);
    for (const item of input.keyResults) {
      if (item.formula.type === "linked_tasks")
        await this.requireTasks(tx, organizationId, item.formula.workItemIds);
    }
    const objectiveId = randomUUID();
    await tx`insert into okr_objectives (id, organization_id, owner_account_id, title, cycle) values (${objectiveId}, ${organizationId}, ${accountId}, ${input.title}, ${input.cycle})`;
    const objectiveRef = {
      organizationId,
      resourceType: "objective" as const,
      resourceId: objectiveId,
    };
    await this.collaboration.registerResource(tx, objectiveRef);
    for (const item of input.keyResults) {
      const id = randomUUID();
      await tx`insert into okr_key_results (id, objective_id, title, weight, formula) values (${id}, ${objectiveId}, ${item.title}, ${item.weight}, ${tx.json(item.formula)})`;
      await this.collaboration.registerResource(tx, {
        organizationId,
        resourceType: "key_result",
        resourceId: id,
      });
    }
    await this.collaboration.appendDomainEvent(tx, {
      accountId,
      aggregate: objectiveRef,
      sequence: 1,
      eventType: "okr.objective.created",
      schemaVersion: 1,
      payload: { cycle: input.cycle },
    });
    return this.state(tx, objectiveId);
  }

  private async requireTasks(
    tx: TransactionClient,
    organizationId: string,
    ids: readonly string[],
  ) {
    const rows = await tx<
      { id: string }[]
    >`select id from work_items where organization_id = ${organizationId} and id = any(${ids})`;
    if (rows.length !== ids.length)
      throw new AuthError("OKR_FORBIDDEN", "linked work is unavailable");
  }

  public async updateProgress(
    tx: TransactionClient,
    accountId: string,
    keyResultId: string,
    raw: unknown,
  ) {
    const input = OkrProgressUpdateRequest.parse(raw);
    const [row] = await tx<(KrRow & { organization_id: string; owner_account_id: string })[]>`
      select kr.*, objective.organization_id, objective.owner_account_id from okr_key_results kr
      join okr_objectives objective on objective.id = kr.objective_id where kr.id = ${keyResultId} for update of kr
    `;
    if (row === undefined) this.notFound();
    const membership = await requireOrganizationMembership(tx, accountId, row.organization_id);
    if (accountId !== row.owner_account_id && !["org_owner", "org_admin"].includes(membership.role))
      this.forbidden();
    if (row.version !== input.expectedVersion) this.conflict();
    const formula = KeyResultFormula.parse(row.formula);
    let progress: number;
    let snapshot: Record<string, JSONValue>;
    if (formula.type === "numeric") {
      progress = Math.max(
        0,
        Math.min(100, ((input.progress - formula.start) / (formula.target - formula.start)) * 100),
      );
      snapshot = { current: input.progress, start: formula.start, target: formula.target };
    } else if (formula.type === "manual") {
      progress = Math.max(0, Math.min(100, input.progress));
      snapshot = { progress: input.progress };
    } else {
      const tasks = await tx<
        { id: string; status: string }[]
      >`select id, status from work_items where organization_id = ${row.organization_id} and id = any(${formula.workItemIds}) order by id`;
      if (tasks.length !== formula.workItemIds.length) this.forbidden();
      progress = (tasks.filter((task) => task.status === "completed").length / tasks.length) * 100;
      snapshot = { tasks: tasks.map((task) => ({ id: task.id, status: task.status })) };
    }
    const [updated] = await tx<
      KrRow[]
    >`update okr_key_results set progress = ${progress}, version = version + 1, updated_at = now() where id = ${keyResultId} returning *`;
    await tx`insert into okr_progress_events (key_result_id, actor_account_id, formula_version, input_snapshot, progress) values (${keyResultId}, ${accountId}, ${row.formula_version}, ${tx.json(snapshot)}, ${progress})`;
    if (updated === undefined) throw new Error("KR update failed");
    await this.collaboration.appendDomainEvent(tx, {
      accountId,
      aggregate: {
        organizationId: row.organization_id,
        resourceType: "key_result",
        resourceId: keyResultId,
      },
      sequence: updated.version,
      eventType: "okr.progress.updated",
      schemaVersion: 1,
      payload: { progress, formulaVersion: row.formula_version, inputSnapshot: snapshot },
    });
    return { keyResult: this.keyResult(updated) };
  }

  public async requestChange(
    tx: TransactionClient,
    accountId: string,
    objectiveId: string,
    raw: unknown,
  ) {
    const input = OkrChangeRequest.parse(raw);
    const [objective] = await tx<
      ObjectiveRow[]
    >`select * from okr_objectives where id = ${objectiveId} for update`;
    if (objective === undefined) this.notFound();
    await requireOrganizationMembership(tx, accountId, objective.organization_id);
    if (objective.owner_account_id !== accountId) this.forbidden();
    if (objective.version !== input.expectedVersion) this.conflict();
    const admins = await tx<
      { account_id: string }[]
    >`select account_id from memberships where organization_id = ${objective.organization_id} and status = 'active' and role in ('org_owner','org_admin') order by created_at`;
    const workItem = await this.work.create(tx, accountId, objective.organization_id, {
      type: "change_request",
      title: `修改 OKR：${objective.title}`,
      description: JSON.stringify(input.patch),
      priority: "normal",
      assigneeAccountIds: admins.map((row) => row.account_id),
    });
    const id = randomUUID();
    await tx`insert into okr_change_requests (id, objective_id, work_item_id, requested_by_account_id, patch) values (${id}, ${objectiveId}, ${workItem.item.id}, ${accountId}, ${tx.json(input.patch)})`;
    await this.collaboration.createLink(tx, {
      accountId,
      source: {
        organizationId: objective.organization_id,
        resourceType: "objective",
        resourceId: objectiveId,
      },
      target: {
        organizationId: objective.organization_id,
        resourceType: "work_item",
        resourceId: workItem.item.id,
      },
      relationType: "change_request",
    });
    return {
      changeRequest: { id, objectiveId, workItemId: workItem.item.id, status: "pending" },
      workItem,
    };
  }

  public async approveChange(
    tx: TransactionClient,
    accountId: string,
    changeRequestId: string,
    raw: unknown,
  ) {
    const input = OkrChangeApprovalRequest.parse(raw);
    const [change] = await tx<
      {
        objective_id: string;
        work_item_id: string;
        patch: Record<string, unknown>;
        status: string;
      }[]
    >`select objective_id, work_item_id, patch, status from okr_change_requests where id = ${changeRequestId} for update`;
    if (change === undefined || change.status !== "pending") this.notFound();
    const [objective] = await tx<
      ObjectiveRow[]
    >`select * from okr_objectives where id = ${change.objective_id} for update`;
    if (objective === undefined) this.notFound();
    const membership = await requireOrganizationMembership(
      tx,
      accountId,
      objective.organization_id,
    );
    if (!["org_owner", "org_admin"].includes(membership.role)) this.forbidden();
    if (objective.version !== input.expectedObjectiveVersion) this.conflict();
    const result = await this.applyPatch(tx, accountId, objective, change.patch, "approved_change");
    await tx`update okr_change_requests set status = 'approved', decided_by_account_id = ${accountId}, decided_at = now() where id = ${changeRequestId}`;
    const work = await this.work.read(
      tx,
      accountId,
      objective.organization_id,
      change.work_item_id,
    );
    await this.work.transition(tx, accountId, change.work_item_id, {
      action: "complete",
      expectedVersion: work.item.version,
    });
    return result;
  }

  public async editObjectiveDirect(
    tx: TransactionClient,
    accountId: string,
    objectiveId: string,
    raw: unknown,
  ) {
    const input = OkrChangeRequest.parse(raw);
    const [objective] = await tx<
      ObjectiveRow[]
    >`select * from okr_objectives where id = ${objectiveId} for update`;
    if (objective === undefined) this.notFound();
    const membership = await requireOrganizationMembership(
      tx,
      accountId,
      objective.organization_id,
    );
    if (!["org_owner", "org_admin"].includes(membership.role)) this.forbidden();
    if (objective.version !== input.expectedVersion) this.conflict();
    return this.applyPatch(tx, accountId, objective, input.patch, "admin_direct");
  }

  private async applyPatch(
    tx: TransactionClient,
    accountId: string,
    objective: ObjectiveRow,
    patch: Record<string, unknown>,
    source: string,
  ) {
    const title = typeof patch.title === "string" ? patch.title : objective.title;
    const cycle = typeof patch.cycle === "string" ? patch.cycle : objective.cycle;
    const [updated] = await tx<
      ObjectiveRow[]
    >`update okr_objectives set title = ${title}, cycle = ${cycle}, version = version + 1, updated_at = now() where id = ${objective.id} returning *`;
    if (updated === undefined) throw new Error("objective update failed");
    await this.collaboration.appendDomainEvent(tx, {
      accountId,
      aggregate: {
        organizationId: objective.organization_id,
        resourceType: "objective",
        resourceId: objective.id,
      },
      sequence: updated.version,
      eventType: "okr.objective.changed",
      schemaVersion: 1,
      payload: { source, patch },
    });
    return { objective: this.objective(updated) };
  }
  private notFound(): never {
    throw new AuthError("OKR_NOT_FOUND", "OKR is unavailable");
  }
  private forbidden(): never {
    throw new AuthError("OKR_FORBIDDEN", "OKR action is forbidden");
  }
  private conflict(): never {
    throw new AuthError("OKR_VERSION_CONFLICT", "OKR changed");
  }
}
