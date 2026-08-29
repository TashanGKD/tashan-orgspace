import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellRing } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { OrgSpaceClient } from "@tashan/sdk";
import { Button, Sheet, SheetContent, SheetTitle } from "../../design-system/primitives/index.js";
import { ResourceListPage } from "../../platform/resources/resource-list-page.js";
import { ResourceRow } from "../../platform/resources/resource-row.js";
import { ResourceState } from "../../platform/resources/resource-states.js";

type Filter = "all" | "unread" | "read";
const eventLabels = {
  approval_requested: "审批",
  emergency: "紧急",
  ordinary_task: "任务",
  deadline_one_hour: "截止提醒",
  meeting_one_hour: "会议提醒",
  daily_summary: "每日汇总",
  partner_follow_up: "合作方跟进",
} as const;

export function NotificationCenter({
  organizationId,
  sdk,
  selectedNotificationId,
}: {
  organizationId: string;
  sdk: OrgSpaceClient;
  selectedNotificationId?: string | undefined;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const [confirmPreference, setConfirmPreference] = useState(false);
  const list = useQuery({
    queryKey: ["organization", organizationId, "notifications", filter],
    queryFn: ({ signal }) =>
      sdk.listNotifications(organizationId, filter === "all" ? {} : { status: filter }, signal),
  });
  const preference = useQuery({
    queryKey: ["organization", organizationId, "notification-preference"],
    queryFn: ({ signal }) => sdk.readNotificationPreference(organizationId, signal),
  });
  const updatePreference = useMutation({
    mutationFn: (enabled: boolean) =>
      sdk.updateNotificationPreference(
        organizationId,
        { dailySummaryEnabled: enabled },
        { idempotencyKey: `web-notification-preference-${crypto.randomUUID()}` },
      ),
    onSuccess: async () => {
      setConfirmPreference(false);
      await queryClient.invalidateQueries({
        queryKey: ["organization", organizationId, "notification-preference"],
      });
    },
  });
  const base = `/org/${organizationId}/notifications`;
  const dailyEnabled = preference.data?.dailySummaryEnabled ?? true;
  return (
    <>
      <ResourceListPage
        title="通知"
        description="查看审批、任务、会议和到期提醒"
        summary={
          <section aria-label="短信通知设置" className="resource-detail-primary">
            <div>
              <strong>每日短信汇总</strong>
              <p>{dailyEnabled ? "每天发送一次工作汇总" : "已关闭每日工作汇总"}</p>
              <small>审批、紧急、截止、会议和合作方提醒不能关闭。</small>
            </div>
            {confirmPreference ? (
              <div className="resource-detail-actions">
                <Button variant="secondary" onClick={() => setConfirmPreference(false)}>
                  取消
                </Button>
                <Button onClick={() => updatePreference.mutate(!dailyEnabled)}>
                  确认{dailyEnabled ? "关闭" : "开启"}每日短信汇总
                </Button>
              </div>
            ) : (
              <Button variant="secondary" onClick={() => setConfirmPreference(true)}>
                {dailyEnabled ? "关闭" : "开启"}每日短信汇总
              </Button>
            )}
          </section>
        }
        toolbar={
          <div className="resource-list-toolbar" aria-label="通知筛选">
            {(["all", "unread", "read"] as const).map((value) => (
              <Button
                key={value}
                variant={filter === value ? "primary" : "quiet"}
                onClick={() => setFilter(value)}
              >
                {value === "all" ? "全部" : value === "unread" ? "未读" : "已读"}
              </Button>
            ))}
          </div>
        }
      >
        {list.isPending ? (
          <ResourceState resourceLabel="通知" state="loading" />
        ) : list.isError ? (
          <ResourceState resourceLabel="通知" state="fatal-error" />
        ) : (list.data?.items ?? []).length === 0 ? (
          <ResourceState resourceLabel="通知" state="empty" />
        ) : (
          (list.data?.items ?? []).map((item) => (
            <ResourceRow
              key={item.id}
              href={`${base}/${item.id}`}
              leading={item.status === "unread" ? <BellRing size={18} /> : <Bell size={18} />}
              title={item.title}
              metadata={[
                eventLabels[item.eventType],
                item.body,
                new Date(item.createdAt).toLocaleString("zh-CN"),
              ]}
              status={{
                label: item.status === "unread" ? "未读" : "已读",
                tone: item.status === "unread" ? "warning" : "neutral",
              }}
            />
          ))
        )}
      </ResourceListPage>
      <NotificationDetail
        notificationId={selectedNotificationId}
        open={selectedNotificationId !== undefined}
        organizationId={organizationId}
        sdk={sdk}
        onOpenChange={(open) => {
          if (!open) navigate(base);
        }}
      />
    </>
  );
}

function NotificationDetail({
  notificationId,
  onOpenChange,
  open,
  organizationId,
  sdk,
}: {
  notificationId?: string | undefined;
  onOpenChange(open: boolean): void;
  open: boolean;
  organizationId: string;
  sdk: OrgSpaceClient;
}) {
  const queryClient = useQueryClient();
  const detail = useQuery({
    enabled: notificationId !== undefined,
    queryKey: ["organization", organizationId, "notification", notificationId],
    queryFn: ({ signal }) => sdk.readNotification(organizationId, notificationId ?? "", signal),
  });
  const markRead = useMutation({
    mutationFn: () =>
      sdk.markNotificationRead(organizationId, notificationId ?? "", {
        idempotencyKey: `web-notification-read-${crypto.randomUUID()}`,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["organization", organizationId, "notification"],
      });
    },
  });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="resource-detail-drawer">
        <SheetTitle>{detail.data?.title ?? "通知详情"}</SheetTitle>
        {detail.isPending ? (
          <ResourceState resourceLabel="通知" state="loading" />
        ) : detail.isError || !detail.data ? (
          <ResourceState resourceLabel="通知" state="fatal-error" />
        ) : (
          <div className="resource-detail-drawer-body">
            <section>
              <p>{detail.data.body}</p>
              <small>{new Date(detail.data.createdAt).toLocaleString("zh-CN")}</small>
            </section>
            {detail.data.status === "unread" ? (
              <Button onClick={() => markRead.mutate()}>标为已读</Button>
            ) : null}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function NotificationPolicyPage({
  organizationId,
  sdk,
}: {
  organizationId: string;
  sdk: OrgSpaceClient;
}) {
  const queryClient = useQueryClient();
  const policy = useQuery({
    queryKey: ["organization", organizationId, "notification-policy"],
    queryFn: ({ signal }) => sdk.readNotificationPolicy(organizationId, signal),
  });
  const [timezone, setTimezone] = useState("");
  useEffect(() => {
    if (policy.data) setTimezone(policy.data.timezone);
  }, [policy.data]);
  const publish = useMutation({
    mutationFn: () =>
      sdk.publishNotificationPolicy(
        organizationId,
        {
          timezone,
          expectedVersion: policy.data?.organizationVersion,
        },
        { idempotencyKey: `web-notification-policy-${crypto.randomUUID()}` },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["organization", organizationId, "notification-policy"],
      }),
  });
  return (
    <ResourceListPage title="组织制度" description="设置组织通知使用的时区">
      {policy.isPending ? (
        <ResourceState resourceLabel="通知规则" state="loading" />
      ) : policy.isError || !policy.data ? (
        <ResourceState resourceLabel="通知规则" state="fatal-error" />
      ) : (
        <form
          className="resource-detail-primary resource-sheet-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (window.confirm("确认发布新的通知规则版本？")) publish.mutate();
          }}
        >
          <label>
            组织时区
            <input
              required
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
            />
          </label>
          <p>当前版本：v{policy.data.policyVersion}</p>
          <p>通知类型和发送规则由平台统一管理，管理员不能关闭强制提醒。</p>
          <Button type="submit">发布新版本</Button>
        </form>
      )}
    </ResourceListPage>
  );
}
