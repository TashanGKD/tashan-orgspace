import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";

import type { OrgSpaceClient } from "@tashan/sdk";

import { createWebQueryClient } from "../../platform/data/query-client.js";
import { FeedbackProvider } from "../../platform/feedback/feedback-context.js";
import { OrganizationHomePage } from "./home-page.js";

afterEach(cleanup);

const organizationId = "95d5579d-a32d-4650-aec4-318ff3a55df1";

test("locks duplicate organization submissions before pending state rerenders", async () => {
  const sdk = {
    listOrganizations: vi.fn().mockResolvedValue({
      items: [{ id: organizationId, name: "他山协会", status: "active" }],
    }),
    createOrganization: vi.fn().mockImplementation(() => new Promise(() => undefined)),
  } as unknown as OrgSpaceClient;
  render(
    <QueryClientProvider client={createWebQueryClient()}>
      <FeedbackProvider>
        <MemoryRouter>
          <OrganizationHomePage organizationId={organizationId} sdk={sdk} />
        </MemoryRouter>
      </FeedbackProvider>
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  expect(await screen.findByText("查看和创建组织")).toBeVisible();
  expect(screen.queryByText(organizationId)).not.toBeInTheDocument();
  await user.type(await screen.findByLabelText("新组织名称"), "重复提交测试");
  const form = screen.getByRole("form", { name: "创建组织" });
  fireEvent.submit(form);
  fireEvent.submit(form);
  await waitFor(() => expect(sdk.createOrganization).toHaveBeenCalledTimes(1));
});

test("keeps the organization ID on the organization detail surface", async () => {
  const sdk = {
    listOrganizations: vi.fn().mockResolvedValue({
      items: [{ id: organizationId, name: "他山协会", status: "active" }],
    }),
    createOrganization: vi.fn(),
  } as unknown as OrgSpaceClient;
  render(
    <QueryClientProvider client={createWebQueryClient()}>
      <FeedbackProvider>
        <MemoryRouter>
          <OrganizationHomePage showOrganizationDetails organizationId={organizationId} sdk={sdk} />
        </MemoryRouter>
      </FeedbackProvider>
    </QueryClientProvider>,
  );
  expect(await screen.findByRole("heading", { name: "组织信息" })).toBeVisible();
  expect(screen.getByText(organizationId)).toBeVisible();
});
