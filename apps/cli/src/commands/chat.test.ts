import { describe, expect, test, vi } from "vitest";
import type { OrgSpaceClient } from "@tashan/sdk";
import { MemoryCredentialStore } from "../credentials/memory-store.js";
import { runCli } from "../program.js";

const dependencies = (client: OrgSpaceClient) => ({
  createClient: vi.fn(() => client),
  credentialStore: new MemoryCredentialStore(),
  deviceId: "3c5442ea-00e2-483b-9e81-2271e34120f1",
  environment: {},
});
describe("chat CLI", () => {
  test("creates a direct conversation with explicit organization and confirmation", async () => {
    const createDirectConversation = vi.fn().mockResolvedValue({ id: crypto.randomUUID() });
    const result = await runCli(
      [
        "chat",
        "conversation",
        "direct-create",
        "--org",
        "35f503c2-a5d7-4250-a337-4f4fd03cf8df",
        "--account",
        "84ecfe2e-c11a-4a56-8735-934955bef834",
        "--yes",
        "--idempotency-key",
        "chat-direct-1",
      ],
      dependencies({ createDirectConversation } as unknown as OrgSpaceClient),
    );
    expect(result.exitCode).toBe(0);
    expect(createDirectConversation).toHaveBeenCalledWith(
      expect.any(String),
      { accountId: "84ecfe2e-c11a-4a56-8735-934955bef834" },
      { idempotencyKey: "chat-direct-1" },
    );
  });
  test("sends one stable client message ID when supplied", async () => {
    const sendChatMessage = vi.fn().mockResolvedValue({ sequence: 1, id: crypto.randomUUID() });
    const clientMessageId = crypto.randomUUID();
    const result = await runCli(
      [
        "chat",
        "message",
        "send",
        "--org",
        "35f503c2-a5d7-4250-a337-4f4fd03cf8df",
        "--conversation",
        "84ecfe2e-c11a-4a56-8735-934955bef834",
        "--body",
        "你好",
        "--client-message-id",
        clientMessageId,
        "--idempotency-key",
        "chat-send-1",
      ],
      dependencies({ sendChatMessage } as unknown as OrgSpaceClient),
    );
    expect(result.exitCode).toBe(0);
    expect(sendChatMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      { clientMessageId, body: "你好" },
      { idempotencyKey: "chat-send-1" },
    );
  });
});
