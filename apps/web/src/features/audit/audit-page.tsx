import { useInfiniteQuery } from "@tanstack/react-query";

import type { OrgSpaceClient } from "@tashan/sdk";

export function AuditPage({
  organizationId,
  sdk,
}: {
  organizationId: string;
  sdk: OrgSpaceClient;
}) {
  const audit = useInfiniteQuery({
    queryKey: ["organization", organizationId, "audit"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      sdk.listAuditEvents(
        {
          organizationId,
          limit: 25,
          ...(pageParam === undefined ? {} : { cursor: pageParam }),
        },
        signal,
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const events = new Map(
    audit.data?.pages.flatMap((page) => page.items).map((event) => [event.id, event]) ?? [],
  );

  return (
    <section className="workspace-card">
      <p className="eyebrow">SECURITY EVIDENCE</p>
      <h1>组织审计</h1>
      {audit.isPending ? <p>正在加载审计记录…</p> : null}
      {audit.isError ? <p role="alert">审计记录加载失败。</p> : null}
      <ol className="audit-list">
        {[...events.values()].map((event) => (
          <li key={event.id}>
            <strong>{event.capabilityId}</strong>
            <span>{event.result}</span>
            <code>{event.requestId}</code>
            <time dateTime={event.occurredAt}>{event.occurredAt}</time>
          </li>
        ))}
      </ol>
      {audit.hasNextPage ? (
        <button
          disabled={audit.isFetchingNextPage}
          type="button"
          onClick={() => void audit.fetchNextPage()}
        >
          {audit.isFetchingNextPage ? "正在加载…" : "加载更多"}
        </button>
      ) : null}
    </section>
  );
}
