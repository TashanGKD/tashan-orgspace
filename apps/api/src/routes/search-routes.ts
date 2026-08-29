import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import { SearchQuery, SearchResponse } from "@tashan/contracts";
import type { DatabaseClient } from "../db/client.js";
import { requestContext } from "../http/request-context.js";
import type { SearchService } from "../search/search-service.js";

const OrganizationPath = z.object({ organizationId: z.uuid() }).strict();
export async function registerSearchRoutes(
  app: FastifyInstance,
  dependencies: {
    sql: DatabaseClient;
    search: SearchService;
    authenticate: preHandlerHookHandler;
  },
) {
  app.get(
    "/v1/organizations/:organizationId/search",
    { config: { capabilityId: "search.query" }, preHandler: dependencies.authenticate },
    async (request) => {
      const path = OrganizationPath.parse(request.params),
        query = SearchQuery.parse(request.query),
        identity = requestContext(request).identity;
      if (!identity) throw new Error("authenticated identity is missing");
      requestContext(request).organizationId = path.organizationId;
      return dependencies.sql.begin(async (tx) =>
        SearchResponse.parse(
          await dependencies.search.search(tx, identity.accountId, path.organizationId, query),
        ),
      );
    },
  );
}
