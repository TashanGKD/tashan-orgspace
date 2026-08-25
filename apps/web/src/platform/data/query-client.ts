import { QueryClient } from "@tanstack/react-query";

import { OrgSpaceApiError } from "@tashan/sdk";

const NEVER_RETRY = new Set([401, 403, 409, 429]);

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  if (error instanceof OrgSpaceApiError && NEVER_RETRY.has(error.status)) return false;
  return !(error instanceof OrgSpaceApiError) || error.status >= 500;
}

export function createWebQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetryQuery, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}
