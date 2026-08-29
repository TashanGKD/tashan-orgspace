import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Target } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import type { OrgSpaceClient } from "@tashan/sdk";
import { Button, Sheet, SheetContent, SheetTitle } from "../../design-system/primitives/index.js";
import { ResourceListPage } from "../../platform/resources/resource-list-page.js";
import { ResourceRow } from "../../platform/resources/resource-row.js";
import { ResourceState } from "../../platform/resources/resource-states.js";

export function OkrPage({
  canManage = false,
  organizationId,
  sdk,
  selectedObjectiveId,
}: {
  canManage?: boolean;
  organizationId: string;
  sdk: OrgSpaceClient;
  selectedObjectiveId?: string | undefined;
}) {
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const list = useQuery({
    queryKey: ["organization", organizationId, "okr"],
    queryFn: ({ signal }) => sdk.listObjectives(organizationId, {}, signal),
  });
  const base = `/org/${organizationId}/okr`;
  return (
    <>
      <ResourceListPage
        title="OKR"
        description="查看组织目标和进度"
        primaryAction={<Button onClick={() => setCreateOpen(true)}>新建目标</Button>}
      >
        {list.isPending ? (
          <ResourceState resourceLabel="OKR" state="loading" />
        ) : list.isError ? (
          <ResourceState resourceLabel="OKR" state="fatal-error" />
        ) : (
          (list.data?.items ?? []).map((item) => (
            <ResourceRow
              key={item.id}
              href={`${base}/${item.id}`}
              leading={<Target size={18} />}
              title={item.title}
              metadata={[item.cycle]}
              status={{
                label: `${Math.round(item.progress)}%`,
                tone: item.progress >= 100 ? "success" : "info",
              }}
            />
          ))
        )}
      </ResourceListPage>
      <OkrCreate
        open={createOpen}
        onOpenChange={setCreateOpen}
        organizationId={organizationId}
        sdk={sdk}
      />
      <OkrDetail
        canManage={canManage}
        open={selectedObjectiveId !== undefined}
        onOpenChange={(open) => {
          if (!open) navigate(base);
        }}
        organizationId={organizationId}
        sdk={sdk}
        objectiveId={selectedObjectiveId}
      />
    </>
  );
}

function OkrCreate({
  open,
  onOpenChange,
  organizationId,
  sdk,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  organizationId: string;
  sdk: OrgSpaceClient;
}) {
  const client = useQueryClient();
  const [title, setTitle] = useState("");
  const [cycle, setCycle] = useState("");
  const [krTitle, setKrTitle] = useState("");
  const create = useMutation({
    mutationFn: () =>
      sdk.createObjective(
        organizationId,
        {
          title,
          cycle,
          keyResults: [{ title: krTitle, weight: 100, formula: { type: "manual" } }],
        },
        { idempotencyKey: `web-okr-${crypto.randomUUID()}` },
      ),
    onSuccess: async () => {
      onOpenChange(false);
      await client.invalidateQueries({ queryKey: ["organization", organizationId, "okr"] });
    },
  });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="resource-form-sheet">
        <SheetTitle>新建目标</SheetTitle>
        <form
          className="resource-sheet-form"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div className="resource-sheet-form-body">
            <label>
              目标
              <input required value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label>
              周期
              <input required value={cycle} onChange={(e) => setCycle(e.target.value)} />
            </label>
            <label>
              关键结果
              <input required value={krTitle} onChange={(e) => setKrTitle(e.target.value)} />
            </label>
          </div>
          <footer className="resource-sheet-form-actions">
            <Button type="submit">创建目标</Button>
          </footer>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function OkrDetail({
  canManage,
  open,
  onOpenChange,
  organizationId,
  sdk,
  objectiveId,
}: {
  canManage: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
  organizationId: string;
  sdk: OrgSpaceClient;
  objectiveId?: string | undefined;
}) {
  const client = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [nextTitle, setNextTitle] = useState("");
  const [nextCycle, setNextCycle] = useState("");
  const detail = useQuery({
    queryKey: ["organization", organizationId, "okr", objectiveId],
    queryFn: ({ signal }) => sdk.readObjective(organizationId, objectiveId ?? "", signal),
    enabled: objectiveId !== undefined,
  });
  const progress = useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      sdk.updateKeyResultProgress(
        organizationId,
        id,
        { progress: Number(values[id] ?? 0), expectedVersion: version },
        { idempotencyKey: `web-okr-progress-${crypto.randomUUID()}` },
      ),
    onSuccess: async () =>
      client.invalidateQueries({ queryKey: ["organization", organizationId, "okr"] }),
  });
  const change = useMutation({
    mutationFn: async (admin: boolean): Promise<void> => {
      const patch = {
        ...(nextTitle.trim() ? { title: nextTitle.trim() } : {}),
        ...(nextCycle.trim() ? { cycle: nextCycle.trim() } : {}),
      };
      const input = { patch, expectedVersion: detail.data?.objective.version };
      if (admin) {
        await sdk.adminEditObjective(organizationId, objectiveId ?? "", input, {
          idempotencyKey: `web-okr-admin-${crypto.randomUUID()}`,
        });
      } else {
        await sdk.requestOkrChange(organizationId, objectiveId ?? "", input, {
          idempotencyKey: `web-okr-change-${crypto.randomUUID()}`,
        });
      }
    },
    onSuccess: async () => {
      setNextTitle("");
      setNextCycle("");
      await client.invalidateQueries({ queryKey: ["organization", organizationId, "okr"] });
    },
  });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetTitle>{detail.data?.objective.title ?? "OKR 详情"}</SheetTitle>
        {detail.isPending ? (
          <ResourceState resourceLabel="OKR 详情" state="loading" />
        ) : detail.data ? (
          <div className="resource-detail-body">
            <p>
              {detail.data.objective.cycle} · {Math.round(detail.data.objective.progress)}%
            </p>
            {detail.data.keyResults.map((kr) => (
              <section key={kr.id}>
                <h3>{kr.title}</h3>
                <p>
                  权重 {kr.weight}% · 当前 {Math.round(kr.progress)}%
                </p>
                <label>
                  更新数值
                  <input
                    type="number"
                    value={values[kr.id] ?? ""}
                    onChange={(e) =>
                      setValues((current) => ({ ...current, [kr.id]: e.target.value }))
                    }
                  />
                </label>
                <Button onClick={() => progress.mutate({ id: kr.id, version: kr.version })}>
                  更新进度
                </Button>
              </section>
            ))}
            <section>
              <h3>修改目标</h3>
              <label>
                新标题
                <input value={nextTitle} onChange={(event) => setNextTitle(event.target.value)} />
              </label>
              <label>
                新周期
                <input value={nextCycle} onChange={(event) => setNextCycle(event.target.value)} />
              </label>
              <div className="resource-detail-actions">
                <Button
                  disabled={!nextTitle.trim() && !nextCycle.trim()}
                  onClick={() => change.mutate(false)}
                >
                  提交修改申请
                </Button>
                {canManage ? (
                  <Button
                    variant="secondary"
                    disabled={!nextTitle.trim() && !nextCycle.trim()}
                    onClick={() => change.mutate(true)}
                  >
                    管理员直接修改
                  </Button>
                ) : null}
              </div>
            </section>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
