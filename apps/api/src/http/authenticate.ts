import type { preHandlerHookHandler } from "fastify";

import type { AuthService } from "../auth/auth-service.js";
import { AuthError } from "../auth/auth-errors.js";
import { requestContext, singleHeader } from "./request-context.js";

export function authenticateWith(auth: AuthService): preHandlerHookHandler {
  return async (request) => {
    const authorization = singleHeader(request, "authorization");
    if (authorization === undefined || !authorization.startsWith("Bearer ")) {
      throw new AuthError("AUTH_REQUIRED", "authentication is required");
    }
    const token = authorization.slice("Bearer ".length);
    if (token.length === 0 || token.includes(" ")) {
      throw new AuthError("AUTH_REQUIRED", "authentication is required");
    }
    const identity = await auth.authenticate(token);
    requestContext(request).identity = identity;
  };
}
