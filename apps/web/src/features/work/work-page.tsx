import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CheckSquare, ClipboardCheck, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import type { OrgSpaceClient } from "@tashan/sdk";
import { Button, Sheet, SheetContent, SheetTitle } from "../../design-system/primitives/index.js";
import { ResourceListPage } from "../../platform/resources/resource-list-page.js";
import { ResourceRow } from "../../platform/resources/resource-row.js";
import { ResourceState } from "../../platform/resources/resource-states.js";

type WorkType = "task" | "meeting" | "approval";
const labels = { task: "任务", meeting: "会议", approval: "审批" } as const;
const icons = { task: CheckSquare, meeting: CalendarDays, approval: ClipboardCheck } as const;
const status = (value: string) =>
  value === "completed"
    ? { label: "已完成", tone: "success" as const }
    : value === "cancelled"
      ? { label: "已取消", tone: "neutral" as const }
      : { label: "进行中", tone: "info" as const };

export function WorkPage({
  organizationId,
  sdk,
  type,
  selectedWorkItemId,
}: {
  organizationId: string;
  sdk: OrgSpaceClient;
  type: WorkType;
  selectedWorkItemId?: string | undefined;
}) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const base = `/org/${organizationId}/${type === "task" ? "tasks" : type === "meeting" ? "meetings" : "approvals"}`;
  const list = useQuery({
    queryKey: ["organization", organizationId, "work", type],
    queryFn: ({ signal }) =>
      sdk.listWorkItems(organizationId, type === "approval" ? {} : { type }, signal),
  });
  const items = (list.data?.items ?? []).filter(
    (item) => type !== "approval" || ["approval", "change_request"].includes(item.type),
  );
  const Icon = icons[type];
  return (
    <>
      <ResourceListPage
        title={labels[type]}
        description={`查看、创建和处理组织${labels[type]}`}
        primaryAction={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={16} aria-hidden />
            新建{labels[type]}
          </Button>
        }
      >
        {list.isPending ? (
          <ResourceState resourceLabel={labels[type]} state="loading" />
        ) : list.isError ? (
          <ResourceState resourceLabel={labels[type]} state="fatal-error" />
        ) : items.length === 0 ? (
          <ResourceState resourceLabel={labels[type]} state="empty" />
        ) : (
          items.map((item) => (
            <ResourceRow
              key={item.id}
              href={`${base}/${item.id}`}
              leading={<Icon size={18} />}
              title={item.title}
              metadata={[item.dueAt ?? item.meetingStartsAt ?? "未设置时间"]}
              status={status(item.status)}
            />
          ))
        )}
      </ResourceListPage>
      <WorkCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        organizationId={organizationId}
        sdk={sdk}
        type={type}
        onCreated={() =>
          client.invalidateQueries({ queryKey: ["organization", organizationId, "work"] })
        }
      />
      <WorkDetail
        open={selectedWorkItemId !== undefined}
        onOpenChange={(open) => {
          if (!open) navigate(base);
        }}
        organizationId={organizationId}
        sdk={sdk}
        workItemId={selectedWorkItemId}
      />
    </>
  );
}

function WorkCreateDialog({
  open,
  onOpenChange,
  organizationId,
  sdk,
  type,
  onCreated,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  organizationId: string;
  sdk: OrgSpaceClient;
  type: WorkType;
  onCreated(): void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const create = useMutation({
    mutationFn: () =>
      (type === "task"
        ? sdk.createTask
        : type === "meeting"
          ? sdk.createMeeting
          : sdk.createApproval)(
        organizationId,
        {
          title,
          description,
          priority: "normal",
          assigneeAccountIds: [],
          ...(type === "meeting" ? { meetingStartsAt: new Date(startsAt).toISOString() } : {}),
        },
        { idempotencyKey: `web-work-${crypto.randomUUID()}` },
      ),
    onSuccess: () => {
      onCreated();
      onOpenChange(false);
      setTitle("");
    },
  });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="resource-form-sheet">
        <SheetTitle>新建{labels[type]}</SheetTitle>
        <form
          aria-label={`新建${labels[type]}`}
          className="resource-sheet-form"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <div className="resource-sheet-form-body">
            <label>
              标题
              <input required value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label>
              说明
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
            {type === "meeting" ? (
              <label>
                开始时间
                <input
                  required
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                />
              </label>
            ) : null}
          </div>
          <footer className="resource-sheet-form-actions">
            <Button disabled={create.isPending} type="submit">
              创建{labels[type]}
            </Button>
          </footer>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function WorkDetail({
  open,
  onOpenChange,
  organizationId,
  sdk,
  workItemId,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  organizationId: string;
  sdk: OrgSpaceClient;
  workItemId?: string | undefined;
}) {
  const client = useQueryClient();
  const [assignee, setAssignee] = useState("");
  const [reason, setReason] = useState("");
  const [target, setTarget] = useState("");
  const detail = useQuery({
    queryKey: ["organization", organizationId, "work", workItemId],
    queryFn: ({ signal }) => sdk.readWorkItem(organizationId, workItemId ?? "", signal),
    enabled: workItemId !== undefined,
  });
  const transition = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      sdk.transitionWorkItem(
        organizationId,
        workItemId ?? "",
        { ...input, expectedVersion: detail.data?.item.version },
        { idempotencyKey: `web-work-${String(input.action)}-${crypto.randomUUID()}` },
      ),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["organization", organizationId, "work"] });
    },
  });
  const change = (() => {
    try {
      return detail.data?.item.type === "change_request"
        ? (JSON.parse(detail.data.item.description) as {
            changeRequestId: string;
            expectedObjectiveVersion: number;
          })
        : undefined;
    } catch {
      return undefined;
    }
  })();
  const approve = useMutation({
    mutationFn: () =>
      sdk.approveOkrChange(
        organizationId,
        change?.changeRequestId ?? "",
        { expectedObjectiveVersion: change?.expectedObjectiveVersion },
        { idempotencyKey: `web-okr-approve-${crypto.randomUUID()}` },
      ),
    onSuccess: () => transition.mutate({ action: "complete" }),
  });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetTitle>{detail.data?.item.title ?? "工作详情"}</SheetTitle>
        {detail.isPending ? (
          <ResourceState resourceLabel="工作详情" state="loading" />
        ) : detail.data ? (
          <div className="resource-detail-body">
            <p>{detail.data.item.description || "暂无说明"}</p>
            <dl>
              <dt>状态</dt>
              <dd>{status(detail.data.item.status).label}</dd>
              <dt>版本</dt>
              <dd>{detail.data.item.version}</dd>
              <dt>负责人</dt>
              <dd>
                {detail.data.assignments.length
                  ? detail.data.assignments.map((item) => item.assigneeAccountId).join("、")
                  : "未指派"}
              </dd>
            </dl>
            {detail.data.item.status === "open" ? (
              <div className="resource-sheet-form-body">
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    transition.mutate({ action: "assign", accountId: assignee });
                  }}
                >
                  <label>
                    指派成员账号 ID
                    <input
                      required
                      value={assignee}
                      onChange={(e) => setAssignee(e.target.value)}
                    />
                  </label>
                  <Button type="submit">指派</Button>
                </form>
                {detail.data.assignments.map((assignment) => (
                  <section
                    key={assignment.id}
                    aria-label={`负责人 ${assignment.assigneeAccountId}`}
                  >
                    <p>
                      {assignment.assigneeAccountId} · {assignment.status}
                    </p>
                    <label>
                      原因
                      <input value={reason} onChange={(e) => setReason(e.target.value)} />
                    </label>
                    <label>
                      转派给
                      <input value={target} onChange={(e) => setTarget(e.target.value)} />
                    </label>
                    <div className="resource-detail-actions">
                      <Button
                        variant="secondary"
                        onClick={() =>
                          transition.mutate({
                            action: "dispute",
                            assignmentId: assignment.id,
                            reason,
                          })
                        }
                      >
                        提出异议
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() =>
                          transition.mutate({
                            action: "request_transfer",
                            assignmentId: assignment.id,
                            targetAccountId: target,
                            reason,
                          })
                        }
                      >
                        申请转派
                      </Button>
                      {assignment.status === "transfer_pending" ? (
                        <Button
                          onClick={() =>
                            transition.mutate({
                              action: "approve_transfer",
                              assignmentId: assignment.id,
                            })
                          }
                        >
                          确认转派
                        </Button>
                      ) : null}
                    </div>
                  </section>
                ))}
              </div>
            ) : null}
            <div className="resource-detail-actions">
              {change ? <Button onClick={() => approve.mutate()}>批准修改</Button> : null}
              {detail.data.item.status === "open" ? (
                <>
                  <Button onClick={() => transition.mutate({ action: "complete" })}>
                    标记完成
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      if (window.confirm("确认取消这项工作？"))
                        transition.mutate({ action: "cancel" });
                    }}
                  >
                    取消
                  </Button>
                </>
              ) : detail.data.item.status === "completed" ? (
                <Button onClick={() => transition.mutate({ action: "reopen" })}>重新打开</Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
