import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { OrgSpaceClient } from "@tashan/sdk";
import { createWebQueryClient } from "../../platform/data/query-client.js";
import { NotificationCenter, NotificationPolicyPage } from "./notification-center.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const organizationId = "95d5579d-a32d-4650-aec4-318ff3a55df1";
const notificationId = "84ecfe2e-c11a-4a56-8735-934955bef834";
function wrapper(children: React.ReactNode) {
  return render(
    <QueryClientProvider client={createWebQueryClient()}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("notification center", () => {
  test("shows list-detail notifications and permits only the daily summary opt-out", async () => {
    const updateNotificationPreference = vi.fn().mockResolvedValue({ dailySummaryEnabled: false });
    const item = {
      id: notificationId,
      organizationId,
      recipientAccountId: crypto.randomUUID(),
      eventType: "emergency" as const,
      title: "紧急通知",
      body: "请立即处理",
      resourceType: null,
      resourceId: null,
      status: "unread" as const,
      createdAt: "2026-08-29T08:00:00.000Z",
      readAt: null,
    };
    const sdk = {
      listNotifications: vi.fn().mockResolvedValue({ items: [item], nextCursor: null }),
      readNotificationPreference: vi.fn().mockResolvedValue({ dailySummaryEnabled: true }),
      updateNotificationPreference,
      readNotification: vi.fn().mockResolvedValue(item),
    } as unknown as OrgSpaceClient;
    wrapper(<NotificationCenter organizationId={organizationId} sdk={sdk} />);
    expect(await screen.findByRole("link", { name: "紧急通知 未读" })).toBeInTheDocument();
    expect(screen.getByText("审批、紧急、截止、会议和合作方提醒不能关闭。")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "关闭每日短信汇总" }));
    await user.click(screen.getByRole("button", { name: "确认关闭每日短信汇总" }));
    expect(updateNotificationPreference).toHaveBeenCalledWith(
      organizationId,
      { dailySummaryEnabled: false },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(screen.queryByRole("button", { name: /关闭审批/ })).not.toBeInTheDocument();
  });

  test("opens notification details in the standard detail drawer", async () => {
    const item = {
      id: notificationId,
      organizationId,
      recipientAccountId: crypto.randomUUID(),
      eventType: "emergency" as const,
      title: "紧急通知",
      body: "请立即处理",
      resourceType: null,
      resourceId: null,
      status: "unread" as const,
      createdAt: "2026-08-29T08:00:00.000Z",
      readAt: null,
    };
    const sdk = {
      listNotifications: vi.fn().mockResolvedValue({ items: [item], nextCursor: null }),
      readNotificationPreference: vi.fn().mockResolvedValue({ dailySummaryEnabled: true }),
      readNotification: vi.fn().mockResolvedValue(item),
    } as unknown as OrgSpaceClient;
    wrapper(
      <NotificationCenter
        organizationId={organizationId}
        sdk={sdk}
        selectedNotificationId={notificationId}
      />,
    );
    expect(await screen.findByRole("dialog", { name: "紧急通知" })).toHaveTextContent("请立即处理");
  });

  test("lets an administrator publish a versioned organization timezone", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const publishNotificationPolicy = vi.fn().mockResolvedValue({});
    wrapper(
      <NotificationPolicyPage
        organizationId={organizationId}
        sdk={
          {
            readNotificationPolicy: vi.fn().mockResolvedValue({
              organizationId,
              policyVersion: 1,
              organizationVersion: 1,
              timezone: "Asia/Shanghai",
            }),
            publishNotificationPolicy,
          } as unknown as OrgSpaceClient
        }
      />,
    );
    const user = userEvent.setup();
    await user.clear(await screen.findByLabelText("组织时区"));
    await user.type(screen.getByLabelText("组织时区"), "America/New_York");
    await user.click(screen.getByRole("button", { name: "发布新版本" }));
    expect(publishNotificationPolicy).toHaveBeenCalledWith(
      organizationId,
      { timezone: "America/New_York", expectedVersion: 1 },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });
});
