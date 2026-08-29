import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { MyWorkListQuery, MyWorkListResponse } from "@tashan/contracts";
import type { DatabaseClient } from "../db/client.js";
import { requestContext } from "../http/request-context.js";
import type { MyWorkService } from "../work/my-work-service.js";

export async function registerMyWorkRoutes(
  app: FastifyInstance,
  dependencies: {
    sql: DatabaseClient;
    myWork: MyWorkService;
    authenticate: preHandlerHookHandler;
  },
) {
  app.get(
    "/v1/my-work",
    { config: { capabilityId: "my.work.list" }, preHandler: dependencies.authenticate },
    async (request) => {
      const identity = requestContext(request).identity;
      if (!identity) throw new Error("authenticated identity is missing");
      return dependencies.sql.begin(async (tx) =>
        MyWorkListResponse.parse(
          await dependencies.myWork.list(
            tx,
            identity.accountId,
            MyWorkListQuery.parse(request.query),
          ),
        ),
      );
    },
  );
}
