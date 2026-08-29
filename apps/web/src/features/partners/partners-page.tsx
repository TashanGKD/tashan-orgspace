import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ContactRound, Download, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import type { OrgSpaceClient } from "@tashan/sdk";
import { Button, Sheet, SheetContent, SheetTitle } from "../../design-system/primitives/index.js";
import { ResourceListPage } from "../../platform/resources/resource-list-page.js";
import { ResourceRow } from "../../platform/resources/resource-row.js";
import { ResourceState } from "../../platform/resources/resource-states.js";

type Scope = "self" | "all" | "awaiting";
const stageLabel = {
  lead: "潜在线索",
  contacting: "联系中",
  active: "合作中",
  paused: "暂停",
  ended: "结束",
} as const;
export function PartnersPage({
  organizationId,
  sdk,
  canManage = false,
  selectedPartnerId,
}: {
  organizationId: string;
  sdk: OrgSpaceClient;
  canManage?: boolean;
  selectedPartnerId?: string | undefined;
}) {
  const navigate = useNavigate(),
    client = useQueryClient();
  const [scope, setScope] = useState<Scope>("self"),
    [createOpen, setCreateOpen] = useState(false),
    [duplicateText, setDuplicateText] = useState("");
  const list = useQuery({
    queryKey: ["organization", organizationId, "partners", scope],
    queryFn: ({ signal }) =>
      scope === "awaiting"
        ? sdk.listAwaitingPartners(organizationId, signal)
        : sdk.listPartners(organizationId, { owner: scope }, signal),
  });
  const exportMutation = useMutation({
    mutationFn: () =>
      sdk.exportPartners(
        organizationId,
        { owner: "all", format: "csv" },
        { idempotencyKey: `web-partner-export-${crypto.randomUUID()}` },
      ),
    onSuccess: (result) => {
      const url = URL.createObjectURL(
        new Blob([result.content], { type: "text/csv;charset=utf-8" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "partners.csv";
      anchor.click();
      URL.revokeObjectURL(url);
    },
  });
  const duplicates = useMutation({
    mutationFn: () => sdk.listPartnerDuplicates(organizationId),
    onSuccess: (r) => setDuplicateText(`${r.groups.length} 组重复候选`),
  });
  const base = `/org/${organizationId}/partners`;
  return (
    <>
      <ResourceListPage
        title="合作方"
        description="查看和跟进组织合作联系人"
        primaryAction={
          <div className="resource-detail-actions">
            {canManage ? (
              <>
                <Button variant="secondary" onClick={() => duplicates.mutate()}>
                  重复候选
                </Button>
                <Button variant="secondary" onClick={() => exportMutation.mutate()}>
                  <Download size={16} />
                  导出
                </Button>
              </>
            ) : null}
            <Button onClick={() => setCreateOpen(true)}>
              <Plus size={16} />
              添加合作方
            </Button>
          </div>
        }
        toolbar={
          <div className="resource-list-toolbar">
            <Button
              variant={scope === "self" ? "primary" : "quiet"}
              onClick={() => setScope("self")}
            >
              我的合作方
            </Button>
            {canManage ? (
              <>
                <Button
                  variant={scope === "all" ? "primary" : "quiet"}
                  onClick={() => setScope("all")}
                >
                  全部合作方
                </Button>
                <Button
                  variant={scope === "awaiting" ? "primary" : "quiet"}
                  onClick={() => setScope("awaiting")}
                >
                  待接管
                </Button>
              </>
            ) : null}
            {duplicateText ? <span>{duplicateText}</span> : null}
          </div>
        }
      >
        {list.isPending ? (
          <ResourceState resourceLabel="合作方" state="loading" />
        ) : list.isError ? (
          <ResourceState resourceLabel="合作方" state="fatal-error" />
        ) : (list.data?.items ?? []).length === 0 ? (
          <ResourceState resourceLabel="合作方" state="empty" />
        ) : (
          (list.data?.items ?? []).map((item) => (
            <ResourceRow
              key={item.id}
              href={`${base}/${item.id}`}
              leading={<ContactRound size={18} />}
              title={item.name}
              metadata={[
                item.organizationName ?? "未填写单位",
                item.jobTitle ?? "未填写职务",
                item.phoneMasked ?? item.emailMasked ?? "未填写联系方式",
              ]}
              status={{
                label:
                  item.recordState === "awaiting_owner"
                    ? "待接管"
                    : item.recordState === "archived"
                      ? "已归档"
                      : stageLabel[item.cooperationStage],
                tone: item.recordState === "active" ? "info" : "warning",
              }}
            />
          ))
        )}
      </ResourceListPage>
      <PartnerCreate
        open={createOpen}
        onOpenChange={setCreateOpen}
        organizationId={organizationId}
        sdk={sdk}
        onDone={() =>
          client.invalidateQueries({ queryKey: ["organization", organizationId, "partners"] })
        }
      />
      <PartnerDetail
        open={selectedPartnerId !== undefined}
        onOpenChange={(open) => {
          if (!open) navigate(base);
        }}
        organizationId={organizationId}
        sdk={sdk}
        partnerId={selectedPartnerId}
        canManage={canManage}
      />
    </>
  );
}
function PartnerCreate({
  open,
  onOpenChange,
  organizationId,
  sdk,
  onDone,
}: {
  open: boolean;
  onOpenChange(v: boolean): void;
  organizationId: string;
  sdk: OrgSpaceClient;
  onDone(): void;
}) {
  const [name, setName] = useState(""),
    [organizationName, setOrganizationName] = useState(""),
    [phone, setPhone] = useState("");
  const create = useMutation({
    mutationFn: () =>
      sdk.createPartner(
        organizationId,
        {
          name,
          organizationName: organizationName || undefined,
          phone: phone || undefined,
          cooperationStage: "lead",
          tags: [],
        },
        { idempotencyKey: `web-partner-create-${crypto.randomUUID()}` },
      ),
    onSuccess: () => {
      onDone();
      onOpenChange(false);
    },
  });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="resource-form-sheet">
        <SheetTitle>添加合作方</SheetTitle>
        <form
          className="resource-sheet-form"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div className="resource-sheet-form-body">
            <label>
              姓名
              <input required value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              单位
              <input
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
              />
            </label>
            <label>
              手机号
              <input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
          </div>
          <footer className="resource-sheet-form-actions">
            <Button type="submit">添加合作方</Button>
          </footer>
        </form>
      </SheetContent>
    </Sheet>
  );
}
function PartnerDetail({
  open,
  onOpenChange,
  organizationId,
  sdk,
  partnerId,
  canManage,
}: {
  open: boolean;
  onOpenChange(v: boolean): void;
  organizationId: string;
  sdk: OrgSpaceClient;
  partnerId?: string | undefined;
  canManage: boolean;
}) {
  const client = useQueryClient();
  const [summary, setSummary] = useState(""),
    [target, setTarget] = useState(""),
    [linkJson, setLinkJson] = useState("");
  const detail = useQuery({
    queryKey: ["organization", organizationId, "partner", partnerId],
    queryFn: ({ signal }) => sdk.readPartner(organizationId, partnerId ?? "", signal),
    enabled: partnerId !== undefined,
  });
  const interactions = useQuery({
    queryKey: ["organization", organizationId, "partner", partnerId, "interactions"],
    queryFn: ({ signal }) => sdk.listPartnerInteractions(organizationId, partnerId ?? "", signal),
    enabled: partnerId !== undefined,
  });
  const refresh = () =>
    client.invalidateQueries({ queryKey: ["organization", organizationId, "partner"] });
  const action = useMutation({
    mutationFn: (kind: "archive" | "restore") =>
      (kind === "archive" ? sdk.archivePartner : sdk.restorePartner)(
        organizationId,
        partnerId ?? "",
        { expectedVersion: detail.data?.partner.version },
        { idempotencyKey: `web-partner-${kind}-${crypto.randomUUID()}` },
      ),
    onSuccess: refresh,
  });
  const transfer = useMutation({
    mutationFn: () =>
      sdk.transferPartner(
        organizationId,
        partnerId ?? "",
        { accountId: target, expectedVersion: detail.data?.partner.version },
        { idempotencyKey: `web-partner-transfer-${crypto.randomUUID()}` },
      ),
    onSuccess: refresh,
  });
  const add = useMutation({
    mutationFn: () =>
      sdk.addPartnerInteraction(
        organizationId,
        partnerId ?? "",
        {
          contactedAt: new Date().toISOString(),
          channel: "other",
          summary,
          requiresFollowUp: false,
          links: [],
        },
        { idempotencyKey: `web-partner-interaction-${crypto.randomUUID()}` },
      ),
    onSuccess: () => {
      setSummary("");
      return client.invalidateQueries({
        queryKey: ["organization", organizationId, "partner", partnerId, "interactions"],
      });
    },
  });
  const link = useMutation({
    mutationFn: () =>
      sdk.linkPartnerResource(organizationId, partnerId ?? "", JSON.parse(linkJson), {
        idempotencyKey: `web-partner-link-${crypto.randomUUID()}`,
      }),
  });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetTitle>{detail.data?.partner.name ?? "合作方详情"}</SheetTitle>
        {detail.isPending ? (
          <ResourceState resourceLabel="合作方详情" state="loading" />
        ) : detail.data ? (
          <div className="resource-detail-body">
            <p>
              {detail.data.partner.organizationName ?? "未填写单位"} ·{" "}
              {stageLabel[detail.data.partner.cooperationStage]}
            </p>
            <dl>
              <dt>手机</dt>
              <dd>{detail.data.partner.phone ?? "未填写"}</dd>
              <dt>微信</dt>
              <dd>{detail.data.partner.wechat ?? "未填写"}</dd>
              <dt>邮箱</dt>
              <dd>{detail.data.partner.email ?? "未填写"}</dd>
              <dt>地址</dt>
              <dd>{detail.data.partner.address ?? "未填写"}</dd>
            </dl>
            <div className="resource-detail-actions">
              {detail.data.partner.recordState === "archived" ? (
                <Button onClick={() => action.mutate("restore")}>恢复</Button>
              ) : (
                <Button variant="secondary" onClick={() => action.mutate("archive")}>
                  归档
                </Button>
              )}
            </div>
            <section>
              <h3>转交负责人</h3>
              <label>
                成员账号 ID
                <input value={target} onChange={(e) => setTarget(e.target.value)} />
              </label>
              <Button disabled={!target} onClick={() => transfer.mutate()}>
                确认转交
              </Button>
            </section>
            <section>
              <h3>跟进记录</h3>
              {(interactions.data?.items ?? []).map((item) => (
                <article key={item.id}>
                  <strong>{item.summary}</strong>
                  <p>{item.contactedAt}</p>
                </article>
              ))}
              <label>
                跟进摘要
                <textarea value={summary} onChange={(e) => setSummary(e.target.value)} />
              </label>
              <Button disabled={!summary.trim()} onClick={() => add.mutate()}>
                添加跟进
              </Button>
            </section>
            <section>
              <h3>关联资料</h3>
              <label>
                关联 JSON
                <textarea
                  placeholder='{"type":"task","workItemId":"..."}'
                  value={linkJson}
                  onChange={(e) => setLinkJson(e.target.value)}
                />
              </label>
              <Button disabled={!linkJson.trim()} onClick={() => link.mutate()}>
                添加关联
              </Button>
            </section>
            {canManage ? <p>管理员可在列表查看全部、待接管、重复候选并导出。</p> : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
