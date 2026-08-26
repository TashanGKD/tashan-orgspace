import { useInfiniteQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { useMemo, useState } from "react";

import type { AuditEvent } from "@tashan/contracts";
import type { OrgSpaceClient } from "@tashan/sdk";

import { Button, StatusBadge, type StatusTone } from "../../design-system/primitives/index.js";
import { ResourceDetailPage } from "../../platform/resources/resource-detail-page.js";
import { ResourceListPage } from "../../platform/resources/resource-list-page.js";
import {
  ResourceListToolbar,
  type ResourceView,
} from "../../platform/resources/resource-list-toolbar.js";
import { ResourceRow } from "../../platform/resources/resource-row.js";
import { ResourceState } from "../../platform/resources/resource-states.js";
import { routes } from "../../platform/routing/route-paths.js";

const resultLabel = { success: "成功", rejected: "已拒绝", failure: "失败" } as const;
const resultTone = {
  success: "success",
  rejected: "warning",
  failure: "error",
} as const satisfies Record<AuditEvent["result"], StatusTone>;

function valueOrUnavailable(value: string | null | undefined): string {
  return value === null || value === undefined || value === "" ? "未记录" : value;
}

function AuditDetail({ event }: { event: AuditEvent }) {
  return (
    <ResourceDetailPage
      eyebrow="组织审计事件"
      subtitle={event.occurredAt}
      title={event.capabilityId}
      relationships={
        <dl className="resource-definition-list">
          <div>
            <dt>对象类型</dt>
            <dd>{valueOrUnavailable(event.objectType)}</dd>
          </div>
          <div>
            <dt>对象 ID</dt>
            <dd className="tabular-nums">{valueOrUnavailable(event.objectId)}</dd>
          </div>
          <div>
            <dt>设备</dt>
            <dd>
              {event.device
                ? `${event.device.name} · ${event.device.os} · ${event.device.architecture}`
                : "未记录"}
            </dd>
          </div>
          <div>
            <dt>服务端 IP</dt>
            <dd className="tabular-nums">{valueOrUnavailable(event.serverIp)}</dd>
          </div>
        </dl>
      }
      activity={
        <p className="resource-redaction-notice">
          前后状态已记录；敏感字段只展示服务端脱敏后的审计摘要。
        </p>
      }
    >
      <dl className="resource-definition-list">
        <div>
          <dt>结果</dt>
          <dd>
            <StatusBadge tone={resultTone[event.result]}>{resultLabel[event.result]}</StatusBadge>
          </dd>
        </div>
        <div>
          <dt>请求 ID</dt>
          <dd className="tabular-nums">{event.requestId}</dd>
        </div>
        <div>
          <dt>操作来源</dt>
          <dd>{event.actorSource}</dd>
        </div>
      </dl>
    </ResourceDetailPage>
  );
}

export function AuditPage({
  organizationId,
  sdk,
  selectedEventId,
}: {
  organizationId: string;
  sdk: OrgSpaceClient;
  selectedEventId?: string | undefined;
}) {
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [view, setView] = useState<ResourceView>("list");
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
  const events = useMemo(
    () => [
      ...new Map(
        audit.data?.pages.flatMap((page) => page.items).map((event) => [event.id, event]) ?? [],
      ).values(),
    ],
    [audit.data?.pages],
  );
  const visibleEvents = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return events.filter(
      (event) =>
        (activeFilter === "all" || event.result === activeFilter) &&
        (normalizedQuery === "" ||
          event.capabilityId.toLocaleLowerCase().includes(normalizedQuery) ||
          event.requestId.toLocaleLowerCase().includes(normalizedQuery)),
    );
  }, [activeFilter, events, query]);

  if (audit.isPending) return <ResourceState resourceLabel="审计记录" state="loading" />;
  if (audit.isError) return <ResourceState resourceLabel="审计记录" state="fatal-error" />;
  if (selectedEventId !== undefined) {
    const selected = events.find((event) => event.id === selectedEventId);
    return selected ? (
      <AuditDetail event={selected} />
    ) : (
      <ResourceState resourceLabel="审计记录" state="fatal-error" />
    );
  }

  return (
    <ResourceListPage
      description="记录谁在何时、通过哪台设备、以何种客户端执行了什么能力。"
      title="组织审计"
      toolbar={
        <ResourceListToolbar
          activeFilter={activeFilter}
          filters={[
            { id: "all", label: "全部" },
            { id: "success", label: "成功" },
            { id: "rejected", label: "已拒绝" },
            { id: "failure", label: "失败" },
          ]}
          onFilterChange={setActiveFilter}
          onQueryChange={setQuery}
          onViewChange={setView}
          query={query}
          resourceLabel="审计记录"
          view={view}
        />
      }
    >
      {visibleEvents.length === 0 ? <ResourceState resourceLabel="审计记录" state="empty" /> : null}
      {visibleEvents.map((event) => (
        <ResourceRow
          href={routes.organizationAuditEvent(organizationId, event.id)}
          key={event.id}
          leading={<ScrollText aria-hidden size={17} />}
          metadata={[event.actorSource, event.requestId, event.occurredAt]}
          status={{ label: resultLabel[event.result], tone: resultTone[event.result] }}
          title={event.capabilityId}
        />
      ))}
      {audit.hasNextPage ? (
        <Button
          disabled={audit.isFetchingNextPage}
          variant="secondary"
          onClick={() => void audit.fetchNextPage()}
        >
          {audit.isFetchingNextPage ? "正在加载…" : "加载更多"}
        </Button>
      ) : null}
    </ResourceListPage>
  );
}
