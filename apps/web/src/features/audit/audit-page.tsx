import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";

import type { AuditEvent } from "@tashan/contracts";
import type { OrgSpaceClient } from "@tashan/sdk";

import {
  auditActionLabel,
  auditActorSourceLabel,
  pageCopy,
} from "../../content/user-facing-copy.js";
import { Button, StatusBadge, type StatusTone } from "../../design-system/primitives/index.js";
import { ResourceDetailDrawer } from "../../platform/resources/resource-detail-drawer.js";
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

async function findAuditEvent(
  sdk: OrgSpaceClient,
  organizationId: string,
  eventId: string,
  signal: AbortSignal,
): Promise<AuditEvent | null> {
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  while (true) {
    const page = await sdk.listAuditEvents(
      { organizationId, limit: 100, ...(cursor === undefined ? {} : { cursor }) },
      signal,
    );
    const event = page.items.find((candidate) => candidate.id === eventId);
    if (event !== undefined) return event;
    if (page.nextCursor === null) return null;
    if (seenCursors.has(page.nextCursor)) {
      return null;
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
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
  const navigate = useNavigate();
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
    enabled: selectedEventId === undefined,
  });
  const auditDetail = useQuery({
    queryKey: ["organization", organizationId, "audit", "detail", selectedEventId],
    enabled: selectedEventId !== undefined,
    queryFn: ({ signal }) => findAuditEvent(sdk, organizationId, selectedEventId ?? "", signal),
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
          auditActionLabel(event.capabilityId).toLocaleLowerCase().includes(normalizedQuery) ||
          event.capabilityId.toLocaleLowerCase().includes(normalizedQuery) ||
          event.requestId.toLocaleLowerCase().includes(normalizedQuery)),
    );
  }, [activeFilter, events, query]);
  const selectedEvent = auditDetail.data ?? undefined;
  const displayedEvents =
    selectedEventId === undefined ? visibleEvents : selectedEvent ? [selectedEvent] : [];

  return (
    <>
      <ResourceListPage
        description={pageCopy.audit.description}
        title="操作记录"
        view={view}
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
            resourceLabel="操作记录"
            view={view}
          />
        }
      >
        {selectedEventId === undefined && audit.isPending ? (
          <ResourceState resourceLabel="操作记录" state="loading" />
        ) : null}
        {selectedEventId === undefined && audit.isError ? (
          <ResourceState resourceLabel="操作记录" state="fatal-error" />
        ) : null}
        {selectedEventId !== undefined && auditDetail.isPending ? (
          <ResourceState resourceLabel="操作记录" state="loading" />
        ) : null}
        {selectedEventId !== undefined && (auditDetail.isError || auditDetail.data === null) ? (
          <ResourceState resourceLabel="操作记录" state="fatal-error" />
        ) : null}
        {!audit.isPending && !audit.isError && displayedEvents.length === 0 ? (
          <ResourceState resourceLabel="操作记录" state="empty" />
        ) : null}
        {displayedEvents.map((event) => (
          <ResourceRow
            href={routes.organizationAuditEvent(organizationId, event.id)}
            key={event.id}
            leading={<ScrollText aria-hidden size={17} />}
            metadata={[auditActorSourceLabel(event.actorSource), event.occurredAt]}
            status={{ label: resultLabel[event.result], tone: resultTone[event.result] }}
            title={auditActionLabel(event.capabilityId)}
          />
        ))}
        {selectedEventId === undefined && audit.hasNextPage ? (
          <Button
            disabled={audit.isFetchingNextPage}
            variant="secondary"
            onClick={() => void audit.fetchNextPage()}
          >
            {audit.isFetchingNextPage ? "正在加载…" : "加载更多"}
          </Button>
        ) : null}
      </ResourceListPage>

      <ResourceDetailDrawer
        detail={
          selectedEvent ? (
            <>
              <dl className="resource-definition-list">
                <div>
                  <dt>结果</dt>
                  <dd>
                    <StatusBadge tone={resultTone[selectedEvent.result]}>
                      {resultLabel[selectedEvent.result]}
                    </StatusBadge>
                  </dd>
                </div>
                <div>
                  <dt>操作来源</dt>
                  <dd>{auditActorSourceLabel(selectedEvent.actorSource)}</dd>
                </div>
                <div>
                  <dt>发生时间</dt>
                  <dd>{selectedEvent.occurredAt}</dd>
                </div>
                <div>
                  <dt>对象类型</dt>
                  <dd>{valueOrUnavailable(selectedEvent.objectType)}</dd>
                </div>
              </dl>
              <p className="resource-redaction-notice">部分敏感信息已隐藏</p>
            </>
          ) : auditDetail.isPending ? (
            <ResourceState resourceLabel="操作记录" state="loading" />
          ) : (
            <ResourceState resourceLabel="操作记录" state="fatal-error" />
          )
        }
        onOpenChange={(open) => {
          if (!open) navigate(routes.organizationAudit(organizationId));
        }}
        open={selectedEventId !== undefined}
        technical={
          selectedEvent ? (
            <dl className="resource-definition-list">
              <div>
                <dt>记录 ID</dt>
                <dd className="tabular-nums">{selectedEvent.id}</dd>
              </div>
              <div>
                <dt>操作 ID</dt>
                <dd>{selectedEvent.capabilityId}</dd>
              </div>
              <div>
                <dt>请求 ID</dt>
                <dd className="tabular-nums">{selectedEvent.requestId}</dd>
              </div>
              <div>
                <dt>对象 ID</dt>
                <dd className="tabular-nums">{valueOrUnavailable(selectedEvent.objectId)}</dd>
              </div>
              <div>
                <dt>设备</dt>
                <dd>
                  {selectedEvent.device
                    ? `${selectedEvent.device.name} · ${selectedEvent.device.os} · ${selectedEvent.device.architecture}`
                    : "未记录"}
                </dd>
              </div>
              <div>
                <dt>服务端 IP</dt>
                <dd className="tabular-nums">{valueOrUnavailable(selectedEvent.serverIp)}</dd>
              </div>
            </dl>
          ) : null
        }
        title={selectedEvent ? auditActionLabel(selectedEvent.capabilityId) : "操作详情"}
        {...(selectedEvent ? { subtitle: selectedEvent.occurredAt } : {})}
      />
    </>
  );
}
