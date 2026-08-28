import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";

import type { OrgSpaceClient } from "@tashan/sdk";

import { pageCopy } from "../../content/user-facing-copy.js";
import { Button, Sheet, SheetContent, SheetTitle } from "../../design-system/primitives/index.js";
import { useFeedback } from "../../platform/feedback/feedback-context.js";
import { ResourceDetailDrawer } from "../../platform/resources/resource-detail-drawer.js";
import { ResourceListPage } from "../../platform/resources/resource-list-page.js";
import { ResourceRow } from "../../platform/resources/resource-row.js";
import { ResourceState } from "../../platform/resources/resource-states.js";
import { routes } from "../../platform/routing/route-paths.js";

function mutationKey(): string {
  return `web-organization-create-${crypto.randomUUID()}`;
}

export function OrganizationHomePage({
  organizationId,
  sdk,
  showOrganizationDetails = false,
}: {
  organizationId: string;
  sdk: OrgSpaceClient;
  showOrganizationDetails?: boolean;
}) {
  const feedback = useFeedback();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const submitLocked = useRef(false);
  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: ({ signal }) => sdk.listOrganizations(signal),
  });
  const createOrganization = useMutation({
    mutationFn: () => sdk.createOrganization({ name }, { idempotencyKey: mutationKey() }),
    onSuccess: async (result) => {
      setName("");
      setCreateOpen(false);
      feedback.showNotice("组织已创建");
      await queryClient.invalidateQueries({ queryKey: ["organizations"] });
      navigate(routes.organizationHome(result.organization.id));
    },
    onError: feedback.showError,
    onSettled: () => {
      submitLocked.current = false;
    },
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (submitLocked.current) return;
    submitLocked.current = true;
    feedback.clear();
    createOrganization.mutate();
  }
  const currentOrganization = organizations.data?.items.find(
    (organization) => organization.id === organizationId,
  );

  return (
    <>
      <ResourceListPage
        description={pageCopy.organization.description}
        primaryAction={
          <Button disabled={createOrganization.isPending} onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden size={16} />
            创建组织
          </Button>
        }
        title="组织首页"
      >
        {organizations.isPending ? <ResourceState resourceLabel="组织" state="loading" /> : null}
        {organizations.isError ? <ResourceState resourceLabel="组织" state="fatal-error" /> : null}
        {organizations.data?.items.map((organization) => (
          <ResourceRow
            href={routes.organizationHome(organization.id)}
            key={organization.id}
            leading={<Building2 aria-hidden size={17} />}
            metadata={[]}
            status={{
              label: organization.id === organizationId ? "当前组织" : "可访问",
              tone: organization.id === organizationId ? "info" : "success",
            }}
            title={organization.name}
          />
        ))}
      </ResourceListPage>

      <ResourceDetailDrawer
        detail={
          currentOrganization ? (
            <dl className="resource-definition-list">
              <div>
                <dt>组织名称</dt>
                <dd>{currentOrganization.name}</dd>
              </div>
              <div>
                <dt>状态</dt>
                <dd>正常</dd>
              </div>
            </dl>
          ) : null
        }
        onOpenChange={(open) => {
          if (!open) navigate(routes.organizations);
        }}
        open={showOrganizationDetails && currentOrganization !== undefined}
        technical={
          currentOrganization ? (
            <dl className="resource-definition-list">
              <div>
                <dt>组织 ID</dt>
                <dd className="tabular-nums">{currentOrganization.id}</dd>
              </div>
            </dl>
          ) : null
        }
        title={currentOrganization?.name ?? "组织信息"}
      />

      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent className="resource-form-sheet">
          <SheetTitle>创建组织</SheetTitle>
          <form aria-label="创建组织" className="resource-sheet-form" onSubmit={submit}>
            <div className="resource-sheet-form-body">
              <label>
                新组织名称
                <input required value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <p className="resource-form-hint">新建后你将成为组织所有者，可继续添加成员。</p>
              {feedback.feedback?.kind === "error" ? (
                <div className="resource-form-error" role="alert">
                  <span>{feedback.feedback.message}</span>
                  {feedback.feedback.requestId ? <code>{feedback.feedback.requestId}</code> : null}
                </div>
              ) : null}
            </div>
            <footer className="resource-sheet-form-actions">
              <Button disabled={createOrganization.isPending} type="submit">
                {createOrganization.isPending ? "正在创建…" : "创建组织"}
              </Button>
            </footer>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
