import { z } from "zod";
import { OrganizationId } from "./common.js";
import { ResourceRef } from "./collaboration.js";

export const SearchResourceType = z.enum([
  "file",
  "work_item",
  "objective",
  "partner",
  "member",
  "message",
]);
export const SearchQuery = z
  .object({
    query: z.string().trim().min(2).max(200),
    types: z.preprocess(
      (value) => (typeof value === "string" ? [value] : value),
      z.array(SearchResourceType).max(6).optional(),
    ),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();
export const SearchHit = z
  .object({
    resource: ResourceRef,
    type: SearchResourceType,
    title: z.string().min(1).max(500),
    snippet: z.string().max(500),
    href: z.string().startsWith("/"),
  })
  .strict();
export const SearchGroup = z
  .object({ type: SearchResourceType, items: z.array(SearchHit) })
  .strict();
export const SearchResponse = z
  .object({
    organizationId: OrganizationId,
    query: z.string(),
    groups: z.array(SearchGroup),
    totalAuthorized: z.number().int().min(0),
  })
  .strict();
export type SearchResourceType = z.infer<typeof SearchResourceType>;
export type SearchHit = z.infer<typeof SearchHit>;
