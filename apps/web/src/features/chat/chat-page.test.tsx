import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { OrgSpaceClient } from "@tashan/sdk";
import { createWebQueryClient } from "../../platform/data/query-client.js";
import { ChatPage } from "./chat-page.js";

afterEach(cleanup);
const organizationId = "00000000-0000-4000-8000-000000000001",
  conversationId = "00000000-0000-4000-8000-000000000002",
  accountId = "00000000-0000-4000-8000-000000000003";
function renderPage(sdk: OrgSpaceClient, selectedConversationId?: string) {
  return render(
    <QueryClientProvider client={createWebQueryClient()}>
      <MemoryRouter>
        <ChatPage
          accountId={accountId}
          organizationId={organizationId}
          sdk={sdk}
          selectedConversationId={selectedConversationId}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
describe("ChatPage", () => {
  test("shows the standard conversation list and creation controls", async () => {
    const sdk = {
      listConversations: vi.fn().mockResolvedValue({
        items: [{ id: conversationId, title: "项目群", kind: "group", members: [{}, {}] }],
      }),
    } as unknown as OrgSpaceClient;
    renderPage(sdk);
    expect(await screen.findByRole("link", { name: "项目群 群聊" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发起私聊" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建群聊" })).toBeInTheDocument();
  });
  test("sends structured attachments and mentions from conversation detail", async () => {
    const sendChatMessage = vi.fn().mockResolvedValue({});
    const sdk = {
      listConversations: vi.fn().mockResolvedValue({ items: [] }),
      readConversation: vi.fn().mockResolvedValue({ id: conversationId, title: "项目群" }),
      listChatMessages: vi.fn().mockResolvedValue({ items: [] }),
      listChatEvents: vi.fn().mockResolvedValue({ items: [] }),
      sendChatMessage,
      getRealtimeAccessToken: vi.fn().mockRejectedValue(new Error("offline")),
    } as unknown as OrgSpaceClient;
    renderPage(sdk, conversationId);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("消息"), "请查看资料");
    fireEvent.change(screen.getByLabelText("附件 JSON"), {
      target: {
        value: JSON.stringify([
          { type: "task", workItemId: "00000000-0000-4000-8000-000000000004" },
        ]),
      },
    });
    await user.type(screen.getByLabelText("提到成员（账号 ID，逗号分隔）"), accountId);
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(sendChatMessage).toHaveBeenCalledWith(
      organizationId,
      conversationId,
      expect.objectContaining({
        body: "请查看资料",
        attachments: [{ type: "task", workItemId: "00000000-0000-4000-8000-000000000004" }],
        mentionAccountIds: [accountId],
      }),
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });
});
