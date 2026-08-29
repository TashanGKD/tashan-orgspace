import { randomUUID } from "node:crypto";

import {
  ProcessDecisionRequest,
  ProcessDefinitionCreateRequest,
  ProcessStartRequest,
  ProcessVersionCreateRequest,
} from "@tashan/contracts";

import { AuthError } from "../auth/auth-errors.js";
import { CollaborationRepository } from "../collaboration/collaboration-repository.js";
import type { TransactionClient } from "../db/transaction.js";
import { requireOrganizationMembership } from "../organizations/authorization.js";

type Mode = "single" | "sequence" | "any" | "all";
type InstanceStatus = "pending" | "approved" | "rejected" | "returned" | "withdrawn";
type StepStatus = "waiting" | "pending" | "approved" | "rejected" | "returned" | "skipped";

interface DefinitionRow {
  id: string;
  organization_id: string;
  name: string;
  created_by_account_id: string;
  version: number;
  created_at: Date;
  updated_at: Date;
}
interface VersionRow {
  id: string;
  definition_id: string;
  version_number: number;
  mode: Mode;
  status: "draft" | "published";
  published_at: Date | null;
  created_at: Date;
}
interface InstanceRow {
  id: string;
  organization_id: string;
  definition_version_id: string;
  initiator_account_id: string;
  subject: Record<string, unknown>;
  status: InstanceStatus;
  version: number;
  created_at: Date;
  updated_at: Date;
}
interface StepRow {
  id: string;
  position: number;
  approver_account_id: string;
  transferred_from_account_id: string | null;
  status: StepStatus;
  created_at: Date;
  updated_at: Date;
}

export class ProcessService {
  private readonly collaboration = new CollaborationRepository();

  private definition(row: DefinitionRow) {
    return {
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      createdByAccountId: row.created_by_account_id,
      version: row.version,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
  private version(row: VersionRow) {
    return {
      id: row.id,
      definitionId: row.definition_id,
      versionNumber: row.version_number,
      mode: row.mode,
      status: row.status,
      publishedAt: row.published_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
    };
  }
  private instance(row: InstanceRow) {
    return {
      id: row.id,
      organizationId: row.organization_id,
      definitionVersionId: row.definition_version_id,
      initiatorAccountId: row.initiator_account_id,
      subject: row.subject,
      status: row.status,
      version: row.version,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
  private step(row: StepRow) {
    return {
      id: row.id,
      position: row.position,
      approverAccountId: row.approver_account_id,
      transferredFromAccountId: row.transferred_from_account_id,
      status: row.status,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private async requireAdmin(
    transaction: TransactionClient,
    accountId: string,
    organizationId: string,
  ) {
    await requireOrganizationMembership(transaction, accountId, organizationId, [
      "org_owner",
      "org_admin",
    ]);
  }

  private async requireApprovers(
    transaction: TransactionClient,
    organizationId: string,
    accountIds: readonly string[],
  ) {
    for (const accountId of accountIds) {
      await requireOrganizationMembership(transaction, accountId, organizationId);
    }
  }

  public async createDefinition(
    transaction: TransactionClient,
    accountId: string,
    organizationId: string,
    raw: unknown,
  ) {
    const input = ProcessDefinitionCreateRequest.parse(raw);
    await this.requireAdmin(transaction, accountId, organizationId);
    await this.requireApprovers(transaction, organizationId, input.approverAccountIds);
    const definitionId = randomUUID();
    const versionId = randomUUID();
    const [definition] = await transaction<DefinitionRow[]>`
      insert into process_definitions (id, organization_id, name, created_by_account_id)
      values (${definitionId}, ${organizationId}, ${input.name}, ${accountId}) returning *
    `;
    const [version] = await transaction<VersionRow[]>`
      insert into process_definition_versions (
        id, definition_id, version_number, mode, created_by_account_id
      ) values (${versionId}, ${definitionId}, 1, ${input.mode}, ${accountId}) returning *
    `;
    for (const [index, approverId] of input.approverAccountIds.entries()) {
      await transaction`
        insert into process_definition_steps (definition_version_id, position, approver_account_id)
        values (${versionId}, ${index + 1}, ${approverId})
      `;
    }
    if (definition === undefined || version === undefined) {
      throw new Error("process definition insert returned no row");
    }
    return { definition: this.definition(definition), version: this.version(version) };
  }

  public async createVersion(
    transaction: TransactionClient,
    accountId: string,
    definitionId: string,
    raw: unknown,
  ) {
    const input = ProcessVersionCreateRequest.parse(raw);
    const [definition] = await transaction<DefinitionRow[]>`
      select * from process_definitions where id = ${definitionId} for update
    `;
    if (definition === undefined) this.notFound();
    await this.requireAdmin(transaction, accountId, definition.organization_id);
    if (definition.version !== input.expectedDefinitionVersion) this.versionConflict();
    await this.requireApprovers(transaction, definition.organization_id, input.approverAccountIds);
    const [next] = await transaction<{ version_number: number }[]>`
      select coalesce(max(version_number), 0)::int + 1 as version_number
      from process_definition_versions where definition_id = ${definitionId}
    `;
    const versionId = randomUUID();
    const [version] = await transaction<VersionRow[]>`
      insert into process_definition_versions (
        id, definition_id, version_number, mode, created_by_account_id
      ) values (
        ${versionId}, ${definitionId}, ${next?.version_number ?? 1}, ${input.mode}, ${accountId}
      ) returning *
    `;
    for (const [index, approverId] of input.approverAccountIds.entries()) {
      await transaction`
        insert into process_definition_steps (definition_version_id, position, approver_account_id)
        values (${versionId}, ${index + 1}, ${approverId})
      `;
    }
    const [updated] = await transaction<DefinitionRow[]>`
      update process_definitions set version = version + 1, updated_at = now()
      where id = ${definitionId} returning *
    `;
    if (version === undefined || updated === undefined)
      throw new Error("process version insert failed");
    return { definition: this.definition(updated), version: this.version(version) };
  }

  public async publishVersion(
    transaction: TransactionClient,
    accountId: string,
    versionId: string,
  ) {
    const [joined] = await transaction<(VersionRow & { organization_id: string })[]>`
      select version.*, definition.organization_id
      from process_definition_versions version
      join process_definitions definition on definition.id = version.definition_id
      where version.id = ${versionId} for update
    `;
    if (joined === undefined) this.notFound();
    await this.requireAdmin(transaction, accountId, joined.organization_id);
    if (joined.status !== "draft") this.invalid();
    const [version] = await transaction<VersionRow[]>`
      update process_definition_versions set status = 'published', published_at = now()
      where id = ${versionId} returning *
    `;
    if (version === undefined) throw new Error("process publish returned no row");
    const [definition] = await transaction<DefinitionRow[]>`
      select * from process_definitions where id = ${joined.definition_id}
    `;
    if (definition === undefined) throw new Error("process definition is missing");
    return {
      definition: this.definition(definition),
      version: this.version(version),
    };
  }

  public async start(
    transaction: TransactionClient,
    accountId: string,
    versionId: string,
    raw: unknown,
  ) {
    const input = ProcessStartRequest.parse(raw);
    const [version] = await transaction<
      (VersionRow & { organization_id: string; definition_name: string })[]
    >`
      select version.*, definition.organization_id, definition.name as definition_name
      from process_definition_versions version
      join process_definitions definition on definition.id = version.definition_id
      where version.id = ${versionId}
    `;
    if (version === undefined || version.status !== "published") this.notFound();
    await requireOrganizationMembership(transaction, accountId, version.organization_id);
    const definitionSteps = await transaction<{ position: number; approver_account_id: string }[]>`
      select position, approver_account_id from process_definition_steps
      where definition_version_id = ${versionId} order by position
    `;
    const instanceId = randomUUID();
    await transaction`
      insert into process_instances (
        id, organization_id, definition_version_id, initiator_account_id, subject
      ) values (
        ${instanceId}, ${version.organization_id}, ${versionId}, ${accountId},
        ${transaction.json(input.subject)}
      )
    `;
    for (const step of definitionSteps) {
      const status = version.mode === "sequence" && step.position > 1 ? "waiting" : "pending";
      await transaction`
        insert into process_instance_steps (
          process_instance_id, position, approver_account_id, status
        ) values (${instanceId}, ${step.position}, ${step.approver_account_id}, ${status})
      `;
    }
    const aggregate = {
      organizationId: version.organization_id,
      resourceType: "process_instance" as const,
      resourceId: instanceId,
    };
    await this.collaboration.registerResource(transaction, aggregate);
    await this.collaboration.appendDomainEvent(transaction, {
      accountId,
      aggregate,
      sequence: 1,
      eventType: "process.started",
      schemaVersion: 1,
      payload: { definitionVersionId: versionId, mode: version.mode },
    });
    return this.state(transaction, instanceId);
  }

  private async state(transaction: TransactionClient, instanceId: string) {
    const [instance] = await transaction<InstanceRow[]>`
      select * from process_instances where id = ${instanceId}
    `;
    if (instance === undefined) this.notFound();
    const steps = await transaction<StepRow[]>`
      select * from process_instance_steps where process_instance_id = ${instanceId}
      order by position
    `;
    return { instance: this.instance(instance), steps: steps.map((step) => this.step(step)) };
  }

  public async decide(
    transaction: TransactionClient,
    accountId: string,
    instanceId: string,
    raw: unknown,
  ) {
    const input = ProcessDecisionRequest.parse(raw);
    const [instance] = await transaction<(InstanceRow & { mode: Mode })[]>`
      select instance.*, version.mode from process_instances instance
      join process_definition_versions version on version.id = instance.definition_version_id
      where instance.id = ${instanceId} for update of instance
    `;
    if (instance === undefined) this.notFound();
    await requireOrganizationMembership(transaction, accountId, instance.organization_id);
    if (instance.version !== input.expectedVersion) this.versionConflict();
    if (instance.status !== "pending") this.invalid();

    let step: StepRow | null = null;
    if (input.action === "withdraw") {
      if (instance.initiator_account_id !== accountId) this.forbidden();
    } else {
      const [found] = await transaction<StepRow[]>`
        select * from process_instance_steps
        where process_instance_id = ${instanceId} and approver_account_id = ${accountId}
          and status = 'pending' for update
      `;
      if (found === undefined) {
        throw new AuthError("PROCESS_FORBIDDEN", "process action is forbidden");
      }
      step = found;
    }
    const requireStep = () => {
      if (step === null) throw new Error("process decision step is missing");
      return step;
    };

    let nextStatus: InstanceStatus = "pending";
    if (input.action === "transfer") {
      const currentStep = requireStep();
      await requireOrganizationMembership(
        transaction,
        input.targetAccountId,
        instance.organization_id,
      );
      if (input.targetAccountId === accountId) this.invalid();
      await transaction`
        update process_instance_steps set approver_account_id = ${input.targetAccountId},
          transferred_from_account_id = ${accountId}, updated_at = now() where id = ${currentStep.id}
      `;
    } else if (input.action === "withdraw") {
      nextStatus = "withdrawn";
      await this.finishRemainingSteps(transaction, instanceId);
    } else if (input.action === "return") {
      const currentStep = requireStep();
      nextStatus = "returned";
      await transaction`
        update process_instance_steps set status = 'returned', decided_at = now(), updated_at = now()
        where id = ${currentStep.id}
      `;
      await this.finishRemainingSteps(transaction, instanceId);
    } else if (input.action === "reject") {
      const currentStep = requireStep();
      nextStatus = "rejected";
      await transaction`
        update process_instance_steps set status = 'rejected', decided_at = now(), updated_at = now()
        where id = ${currentStep.id}
      `;
      await this.finishRemainingSteps(transaction, instanceId);
    } else {
      const currentStep = requireStep();
      await transaction`
        update process_instance_steps set status = 'approved', decided_at = now(), updated_at = now()
        where id = ${currentStep.id}
      `;
      if (instance.mode === "single" || instance.mode === "any") {
        nextStatus = "approved";
        await this.finishRemainingSteps(transaction, instanceId);
      } else if (instance.mode === "sequence") {
        const [next] = await transaction<{ id: string }[]>`
          update process_instance_steps set status = 'pending', updated_at = now()
          where process_instance_id = ${instanceId} and status = 'waiting'
            and position = (select min(position) from process_instance_steps
              where process_instance_id = ${instanceId} and status = 'waiting')
          returning id
        `;
        if (next === undefined) nextStatus = "approved";
      } else {
        const [remaining] = await transaction<{ count: number }[]>`
          select count(*)::int as count from process_instance_steps
          where process_instance_id = ${instanceId} and status = 'pending'
        `;
        if (remaining?.count === 0) nextStatus = "approved";
      }
    }

    const nextVersion = instance.version + 1;
    await transaction`
      update process_instances set status = ${nextStatus}, version = ${nextVersion},
        completed_at = ${nextStatus === "pending" ? null : new Date()}, updated_at = now()
      where id = ${instanceId}
    `;
    const reason = "reason" in input && input.reason !== undefined ? input.reason : null;
    const targetAccountId = "targetAccountId" in input ? input.targetAccountId : null;
    await transaction`
      insert into process_decision_events (
        process_instance_id, step_id, actor_account_id, action, reason,
        target_account_id, instance_version
      ) values (
        ${instanceId}, ${step?.id ?? null}, ${accountId}, ${input.action}, ${reason},
        ${targetAccountId}, ${nextVersion}
      )
    `;
    await this.collaboration.appendDomainEvent(transaction, {
      accountId,
      aggregate: {
        organizationId: instance.organization_id,
        resourceType: "process_instance",
        resourceId: instanceId,
      },
      sequence: nextVersion,
      eventType: `process.${input.action}`,
      schemaVersion: 1,
      payload: {
        action: input.action,
        stepId: step?.id ?? null,
        status: nextStatus,
        ...(reason === null ? {} : { reason }),
        ...(targetAccountId === null ? {} : { targetAccountId }),
      },
    });
    return this.state(transaction, instanceId);
  }

  private async finishRemainingSteps(transaction: TransactionClient, instanceId: string) {
    await transaction`
      update process_instance_steps set status = 'skipped', updated_at = now()
      where process_instance_id = ${instanceId} and status in ('waiting', 'pending')
    `;
  }
  private notFound(): never {
    throw new AuthError("PROCESS_NOT_FOUND", "process is unavailable");
  }
  private forbidden(): never {
    throw new AuthError("PROCESS_FORBIDDEN", "process action is forbidden");
  }
  private versionConflict(): never {
    throw new AuthError("PROCESS_VERSION_CONFLICT", "process changed");
  }
  private invalid(): never {
    throw new AuthError("PROCESS_TRANSITION_INVALID", "process transition is invalid");
  }
}
