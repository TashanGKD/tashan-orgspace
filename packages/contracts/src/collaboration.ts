import { z } from "zod";

import { AccountId, IsoDateTime, OrganizationId } from "./common.js";

export const CollaborationResourceType = z.enum([
  "file",
  "folder",
  "work_item",
  "process_instance",
  "objective",
  "key_result",
  "partner",
  "partner_interaction",
  "conversation",
  "message",
  "member",
]);
export type CollaborationResourceType = z.infer<typeof CollaborationResourceType>;

export const CollaborationEventType = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/);
export const CollaborationRelationType = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/);
export const CollaborationSchemaVersion = z.number().int().min(1).max(1_000_000);
export const CollaborationPayload = z.record(z.string(), z.json());

export const ResourceRef = z
  .object({
    organizationId: OrganizationId,
    resourceType: CollaborationResourceType,
    resourceId: z.uuid(),
  })
  .strict();
export type ResourceRef = z.infer<typeof ResourceRef>;

export const ResourceLink = z
  .object({
    id: z.uuid(),
    organizationId: OrganizationId,
    source: ResourceRef,
    target: ResourceRef,
    relationType: CollaborationRelationType,
    createdByAccountId: AccountId,
    createdAt: IsoDateTime,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.source.organizationId !== value.organizationId ||
      value.target.organizationId !== value.organizationId
    ) {
      context.addIssue({ code: "custom", message: "linked resources must share one organization" });
    }
    if (
      value.source.resourceType === value.target.resourceType &&
      value.source.resourceId === value.target.resourceId
    ) {
      context.addIssue({ code: "custom", message: "a resource cannot link to itself" });
    }
  });
export type ResourceLink = z.infer<typeof ResourceLink>;

export const CollaborationComment = z
  .object({
    id: z.uuid(),
    organizationId: OrganizationId,
    resource: ResourceRef,
    body: z.string().trim().min(1).max(20_000),
    authorAccountId: AccountId,
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
  })
  .strict()
  .refine((value) => value.resource.organizationId === value.organizationId, {
    message: "comment resource must share the organization",
  });
export type CollaborationComment = z.infer<typeof CollaborationComment>;

export const ActivityEvent = z
  .object({
    id: z.uuid(),
    organizationId: OrganizationId,
    resource: ResourceRef,
    eventType: CollaborationEventType,
    schemaVersion: CollaborationSchemaVersion,
    actorAccountId: AccountId.nullable(),
    payload: CollaborationPayload,
    createdAt: IsoDateTime,
  })
  .strict()
  .refine((value) => value.resource.organizationId === value.organizationId, {
    message: "activity resource must share the organization",
  });
export type ActivityEvent = z.infer<typeof ActivityEvent>;

export const DomainEvent = z
  .object({
    id: z.uuid(),
    organizationId: OrganizationId,
    aggregate: ResourceRef,
    sequence: z.number().int().min(1),
    eventType: CollaborationEventType,
    schemaVersion: CollaborationSchemaVersion,
    actorAccountId: AccountId.nullable(),
    payload: CollaborationPayload,
    createdAt: IsoDateTime,
  })
  .strict()
  .refine((value) => value.aggregate.organizationId === value.organizationId, {
    message: "domain aggregate must share the organization",
  });
export type DomainEvent = z.infer<typeof DomainEvent>;
