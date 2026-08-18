import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";

import type { OrgSpaceClient } from "@tashan/sdk";

import { useFeedback } from "../../platform/feedback/feedback-context.js";
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
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    feedback.clear();
    createOrganization.mutate();
  }

  return (
    <>
      <section className="workspace-intro">
        <p className="eyebrow">ORGANIZATION CONTROL DESK</p>
        <h1>组织首页</h1>
        <p>当前版本已接通账号、设备、组织成员和审计；其他模块按路线图逐步开放。</p>
      </section>
      <section className="workspace-card">
        <h2>切换或创建组织</h2>
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
        <form className="inline-form" onSubmit={submit}>
          <label>
            新组织名称
            <input required value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <button disabled={createOrganization.isPending} type="submit">
            {createOrganization.isPending ? "正在创建…" : "创建组织"}
          </button>
        </form>
      </section>
    </>
  );
}
