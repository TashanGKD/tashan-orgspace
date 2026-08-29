import { randomUUID } from "node:crypto";

import {
  CollaborationComment,
  CollaborationEventType,
  CollaborationPayload,
  CollaborationRelationType,
  CollaborationSchemaVersion,
  DomainEvent,
  ResourceLink,
  ResourceRef,
} from "@tashan/contracts";

import { AuthError } from "../auth/auth-errors.js";
import type { TransactionClient } from "../db/transaction.js";
import { requireOrganizationMembership } from "../organizations/authorization.js";
import { OutboxRepository } from "../repositories/outbox-repository.js";

export class CollaborationRepository {
  private readonly outbox = new OutboxRepository();

  public async registerResource(transaction: TransactionClient, raw: unknown) {
    const resource = ResourceRef.parse(raw);
    await transaction`
      insert into collaboration_resources (organization_id, resource_type, resource_id)
      values (${resource.organizationId}, ${resource.resourceType}, ${resource.resourceId})
      on conflict (resource_type, resource_id) do nothing
    `;
    const [registered] = await transaction<
      { organization_id: string; resource_type: string; resource_id: string }[]
    >`
      select organization_id, resource_type, resource_id from collaboration_resources
      where resource_type = ${resource.resourceType} and resource_id = ${resource.resourceId}
    `;
    if (registered?.organization_id !== resource.organizationId) {
      throw new AuthError("ORG_FORBIDDEN", "resource belongs to another organization");
    }
    return resource;
  }

  private async requireResource(transaction: TransactionClient, resource: ResourceRef) {
    const [row] = await transaction<{ exists: boolean }[]>`
      select exists(
        select 1 from collaboration_resources
        where organization_id = ${resource.organizationId}
          and resource_type = ${resource.resourceType}
          and resource_id = ${resource.resourceId}
      ) as exists
    `;
    if (row?.exists !== true) throw new AuthError("ORG_FORBIDDEN", "resource is unavailable");
  }

  private async appendActivity(
    transaction: TransactionClient,
    input: {
      accountId: string | null;
      resource: ResourceRef;
      eventType: string;
      schemaVersion: number;
      payload: Record<string, unknown>;
    },
  ) {
    const eventType = CollaborationEventType.parse(input.eventType);
    const schemaVersion = CollaborationSchemaVersion.parse(input.schemaVersion);
    const payload = CollaborationPayload.parse(input.payload);
    const [row] = await transaction<{ id: string; created_at: Date }[]>`
      insert into activity_events (
        organization_id, resource_type, resource_id, event_type, schema_version,
        actor_account_id, payload
      ) values (
        ${input.resource.organizationId}, ${input.resource.resourceType},
        ${input.resource.resourceId}, ${eventType}, ${schemaVersion}, ${input.accountId},
        ${transaction.json(payload)}
      ) returning id, created_at
    `;
    if (row === undefined) throw new Error("activity event insert returned no row");
    return row;
  }

  public async createLink(
    transaction: TransactionClient,
    raw: {
      accountId: string;
      source: unknown;
      target: unknown;
      relationType: string;
    },
  ) {
    const source = ResourceRef.parse(raw.source);
    const target = ResourceRef.parse(raw.target);
    const relationType = CollaborationRelationType.parse(raw.relationType);
    if (source.organizationId !== target.organizationId) {
      throw new AuthError("ORG_FORBIDDEN", "linked resources must share one organization");
    }
    if (source.resourceType === target.resourceType && source.resourceId === target.resourceId) {
      throw new AuthError("VALIDATION_FAILED", "a resource cannot link to itself");
    }
    await requireOrganizationMembership(transaction, raw.accountId, source.organizationId);
    await this.requireResource(transaction, source);
    await this.requireResource(transaction, target);
    const id = randomUUID();
    let row: { created_at: Date } | undefined;
    try {
      [row] = await transaction<{ created_at: Date }[]>`
        insert into resource_links (
          id, organization_id, source_type, source_id, target_type, target_id,
          relation_type, created_by_account_id
        ) values (
          ${id}, ${source.organizationId}, ${source.resourceType}, ${source.resourceId},
          ${target.resourceType}, ${target.resourceId}, ${relationType}, ${raw.accountId}
        ) returning created_at
      `;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "constraint_name" in error &&
        error.constraint_name === "resource_links_unique"
      ) {
        throw new AuthError("VALIDATION_FAILED", "resource link already exists");
      }
      throw error;
    }
    if (row === undefined) throw new Error("resource link insert returned no row");
    await this.appendActivity(transaction, {
      accountId: raw.accountId,
      resource: source,
      eventType: "resource.linked",
      schemaVersion: 1,
      payload: { linkId: id, target, relationType },
    });
    return ResourceLink.parse({
      id,
      organizationId: source.organizationId,
      source,
      target,
      relationType,
      createdByAccountId: raw.accountId,
      createdAt: row.created_at.toISOString(),
    });
  }

  public async addComment(
    transaction: TransactionClient,
    raw: { accountId: string; resource: unknown; body: string },
  ) {
    const resource = ResourceRef.parse(raw.resource);
    await requireOrganizationMembership(transaction, raw.accountId, resource.organizationId);
    await this.requireResource(transaction, resource);
    const body = raw.body.trim();
    const id = randomUUID();
    const [row] = await transaction<{ created_at: Date; updated_at: Date }[]>`
      insert into collaboration_comments (
        id, organization_id, resource_type, resource_id, body, author_account_id
      ) values (
        ${id}, ${resource.organizationId}, ${resource.resourceType}, ${resource.resourceId},
        ${body}, ${raw.accountId}
      ) returning created_at, updated_at
    `;
    if (row === undefined) throw new Error("comment insert returned no row");
    const comment = CollaborationComment.parse({
      id,
      organizationId: resource.organizationId,
      resource,
      body,
      authorAccountId: raw.accountId,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    });
    await this.appendActivity(transaction, {
      accountId: raw.accountId,
      resource,
      eventType: "comment.created",
      schemaVersion: 1,
      payload: { commentId: id },
    });
    return comment;
  }

  public async appendDomainEvent(
    transaction: TransactionClient,
    raw: {
      accountId: string | null;
      aggregate: unknown;
      sequence: number;
      eventType: string;
      schemaVersion: number;
      payload: Record<string, unknown>;
    },
  ) {
    const aggregate = ResourceRef.parse(raw.aggregate);
    const eventType = CollaborationEventType.parse(raw.eventType);
    const schemaVersion = CollaborationSchemaVersion.parse(raw.schemaVersion);
    const payload = CollaborationPayload.parse(raw.payload);
    if (raw.accountId !== null) {
      await requireOrganizationMembership(transaction, raw.accountId, aggregate.organizationId);
    }
    await this.requireResource(transaction, aggregate);
    const id = randomUUID();
    const [row] = await transaction<{ created_at: Date }[]>`
      insert into domain_events (
        id, organization_id, aggregate_type, aggregate_id, sequence, event_type,
        schema_version, actor_account_id, payload
      ) values (
        ${id}, ${aggregate.organizationId}, ${aggregate.resourceType}, ${aggregate.resourceId},
        ${raw.sequence}, ${eventType}, ${schemaVersion}, ${raw.accountId},
        ${transaction.json(payload)}
      ) returning created_at
    `;
    if (row === undefined) throw new Error("domain event insert returned no row");
    const event = DomainEvent.parse({
      id,
      organizationId: aggregate.organizationId,
      aggregate,
      sequence: raw.sequence,
      eventType,
      schemaVersion,
      actorAccountId: raw.accountId,
      payload,
      createdAt: row.created_at.toISOString(),
    });
    await this.outbox.append(transaction, {
      eventType: "domain.event",
      payload: {
        domainEventId: event.id,
        organizationId: event.organizationId,
        aggregateType: event.aggregate.resourceType,
        aggregateId: event.aggregate.resourceId,
        eventType: event.eventType,
        schemaVersion: event.schemaVersion,
      },
    });
    return event;
  }
}
