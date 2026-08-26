import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";

import type { OrgSpaceClient } from "@tashan/sdk";

import { pageCopy } from "../../content/user-facing-copy.js";
import { Button } from "../../design-system/primitives/index.js";
import { useFeedback } from "../../platform/feedback/feedback-context.js";
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
}: {
  organizationId: string;
  sdk: OrgSpaceClient;
}) {
  const feedback = useFeedback();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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

  return (
    <ResourceListPage
      description={pageCopy.organization.description}
      primaryAction={
        <Button disabled={createOrganization.isPending} form="create-organization" type="submit">
          <Plus aria-hidden size={16} />
          {createOrganization.isPending ? "正在创建…" : "创建组织"}
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
      <section className="resource-create-section" aria-labelledby="organization-create-title">
        <h2 id="organization-create-title">切换或创建组织</h2>
        <label>
          当前组织
          <select
            aria-label="当前组织"
            value={organizationId}
            onChange={(event) => navigate(routes.organizationHome(event.target.value))}
          >
            {organizations.data?.items.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </select>
        </label>
        <form
          aria-label="创建组织"
          className="resource-inline-form"
          id="create-organization"
          onSubmit={submit}
        >
          <label>
            新组织名称
            <input required value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <span className="resource-form-hint">
            新建后你将成为组织所有者，可继续配置成员和额度。
          </span>
        </form>
      </section>
    </ResourceListPage>
  );
}
