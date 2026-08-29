import { useQuery } from "@tanstack/react-query";
import { Bell, CalendarDays, ClipboardCheck, ListTodo, MessageCircle } from "lucide-react";
import { useState } from "react";
import type { OrgSpaceClient } from "@tashan/sdk";
import { Button } from "../../design-system/primitives/index.js";
import { ResourceListPage } from "../../platform/resources/resource-list-page.js";
import { ResourceRow } from "../../platform/resources/resource-row.js";
import { ResourceState } from "../../platform/resources/resource-states.js";

type Kind = "all" | "task" | "meeting" | "approval" | "reminder" | "mention";
const labels = {
  all: "全部",
  task: "任务",
  meeting: "会议",
  approval: "审批",
  reminder: "提醒",
  mention: "提到我的",
} as const;
const icons = {
  task: ListTodo,
  meeting: CalendarDays,
  approval: ClipboardCheck,
  reminder: Bell,
  mention: MessageCircle,
} as const;
export function MyWorkPage({ sdk }: { sdk: OrgSpaceClient }) {
  const [kind, setKind] = useState<Kind>("all");
  const result = useQuery({
    queryKey: ["my-work", kind],
    queryFn: ({ signal }) => sdk.listMyWork(kind === "all" ? {} : { kind }, signal),
  });
  return (
    <ResourceListPage
      title="我的工作"
      description="查看分配给你的任务、审批、会议、提醒和消息"
      toolbar={
        <div className="resource-list-toolbar" aria-label="工作筛选">
          {(Object.keys(labels) as Kind[]).map((value) => (
            <Button
              key={value}
              variant={kind === value ? "primary" : "quiet"}
              onClick={() => setKind(value)}
            >
              {labels[value]}
            </Button>
          ))}
        </div>
      }
    >
      {result.isPending ? (
        <ResourceState resourceLabel="工作" state="loading" />
      ) : result.isError ? (
        <ResourceState resourceLabel="工作" state="fatal-error" />
      ) : (result.data?.items ?? []).length === 0 ? (
        <ResourceState resourceLabel="工作" state="empty" />
      ) : (
        (result.data?.items ?? []).map((item) => {
          const Icon = icons[item.kind];
          return (
            <ResourceRow
              key={item.id}
              href={item.href}
              leading={<Icon size={18} />}
              title={item.title}
              metadata={[
                item.organizationName,
                item.dueAt ? new Date(item.dueAt).toLocaleString("zh-CN") : "",
              ].filter(Boolean)}
              status={{
                label: labels[item.kind],
                tone: item.kind === "reminder" ? "warning" : "info",
              }}
            />
          );
        })
      )}
    </ResourceListPage>
  );
}
