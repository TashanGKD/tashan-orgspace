import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Plus, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { encodeRealtimeAccessToken, type OrgSpaceClient } from "@tashan/sdk";
import { Button, Sheet, SheetContent, SheetTitle } from "../../design-system/primitives/index.js";
import { ResourceListPage } from "../../platform/resources/resource-list-page.js";
import { ResourceRow } from "../../platform/resources/resource-row.js";
import { ResourceState } from "../../platform/resources/resource-states.js";

function key(prefix: string) {
  return `web-${prefix}-${crypto.randomUUID()}`;
}
export function ChatPage({
  accountId,
  organizationId,
  sdk,
  selectedConversationId,
}: {
  accountId: string;
  organizationId: string;
  sdk: OrgSpaceClient;
  selectedConversationId?: string | undefined;
}) {
  const queryClient = useQueryClient(),
    navigate = useNavigate();
  const [directAccountId, setDirectAccountId] = useState(""),
    [groupTitle, setGroupTitle] = useState(""),
    [groupMembers, setGroupMembers] = useState("");
  const conversations = useQuery({
    queryKey: ["organization", organizationId, "conversations"],
    queryFn: ({ signal }) => sdk.listConversations(organizationId, signal),
  });
  const direct = useMutation({
    mutationFn: () =>
      sdk.createDirectConversation(
        organizationId,
        { accountId: directAccountId },
        { idempotencyKey: key("direct") },
      ),
    onSuccess: async () => {
      setDirectAccountId("");
      await queryClient.invalidateQueries({
        queryKey: ["organization", organizationId, "conversations"],
      });
    },
  });
  const group = useMutation({
    mutationFn: () =>
      sdk.createGroupConversation(
        organizationId,
        {
          title: groupTitle,
          memberAccountIds: groupMembers
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        },
        { idempotencyKey: key("group") },
      ),
    onSuccess: async () => {
      setGroupTitle("");
      setGroupMembers("");
      await queryClient.invalidateQueries({
        queryKey: ["organization", organizationId, "conversations"],
      });
    },
  });
  const base = `/org/${organizationId}/messages`;
  return (
    <>
      <ResourceListPage
        title="消息"
        description="与组织成员私聊或创建群聊"
        summary={
          <div className="resource-summary-grid">
            <form
              className="resource-detail-primary"
              onSubmit={(event) => {
                event.preventDefault();
                direct.mutate();
              }}
            >
              <strong>发起私聊</strong>
              <label>
                成员账号 ID
                <input
                  required
                  value={directAccountId}
                  onChange={(event) => setDirectAccountId(event.target.value)}
                />
              </label>
              <Button type="submit">
                <Plus size={16} />
                发起私聊
              </Button>
            </form>
            <form
              className="resource-detail-primary"
              onSubmit={(event) => {
                event.preventDefault();
                group.mutate();
              }}
            >
              <strong>创建群聊</strong>
              <label>
                群聊名称
                <input
                  required
                  value={groupTitle}
                  onChange={(event) => setGroupTitle(event.target.value)}
                />
              </label>
              <label>
                成员账号 ID（逗号分隔）
                <input
                  required
                  value={groupMembers}
                  onChange={(event) => setGroupMembers(event.target.value)}
                />
              </label>
              <Button type="submit">
                <Plus size={16} />
                创建群聊
              </Button>
            </form>
          </div>
        }
      >
        {conversations.isPending ? (
          <ResourceState resourceLabel="会话" state="loading" />
        ) : conversations.isError ? (
          <ResourceState resourceLabel="会话" state="fatal-error" />
        ) : (conversations.data?.items ?? []).length === 0 ? (
          <ResourceState resourceLabel="会话" state="empty" />
        ) : (
          (conversations.data?.items ?? []).map((conversation) => (
            <ResourceRow
              key={conversation.id}
              href={`${base}/${conversation.id}`}
              leading={<MessageCircle size={18} />}
              title={conversation.title ?? "私聊"}
              metadata={[`${conversation.members.length} 位成员`]}
              status={{ label: conversation.kind === "group" ? "群聊" : "私聊", tone: "info" }}
            />
          ))
        )}
      </ResourceListPage>
      <ConversationDetail
        accountId={accountId}
        conversationId={selectedConversationId}
        open={selectedConversationId !== undefined}
        organizationId={organizationId}
        sdk={sdk}
        onOpenChange={(open) => {
          if (!open) navigate(base);
        }}
      />
    </>
  );
}

function ConversationDetail({
  accountId,
  conversationId,
  onOpenChange,
  open,
  organizationId,
  sdk,
}: {
  accountId: string;
  conversationId?: string | undefined;
  onOpenChange(open: boolean): void;
  open: boolean;
  organizationId: string;
  sdk: OrgSpaceClient;
}) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState(""),
    [attachments, setAttachments] = useState("[]"),
    [mentions, setMentions] = useState(""),
    [editing, setEditing] = useState<string | null>(null),
    [editBody, setEditBody] = useState("");
  const detail = useQuery({
    enabled: !!conversationId,
    queryKey: ["organization", organizationId, "conversation", conversationId],
    queryFn: ({ signal }) => sdk.readConversation(organizationId, conversationId ?? "", signal),
  });
  const messages = useQuery({
    enabled: !!conversationId,
    queryKey: ["organization", organizationId, "conversation", conversationId, "messages"],
    queryFn: ({ signal }) => sdk.listChatMessages(organizationId, conversationId ?? "", {}, signal),
  });
  const events = useQuery({
    enabled: !!conversationId,
    queryKey: ["organization", organizationId, "conversation", conversationId, "events"],
    queryFn: ({ signal }) => sdk.listChatEvents(organizationId, conversationId ?? "", {}, signal),
  });
  useEffect(() => {
    if (!conversationId || typeof WebSocket === "undefined") return;
    let active = true,
      socket: WebSocket | undefined,
      reconnect: number | undefined;
    const connect = async () => {
      try {
        const token = await sdk.getRealtimeAccessToken();
        if (!active) return;
        const url = new URL("/v1/realtime", window.location.origin);
        url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        socket = new WebSocket(url, [
          "torg.realtime.v1",
          `torg.token.${encodeRealtimeAccessToken(token)}`,
        ]);
        socket.onopen = () =>
          socket?.send(
            JSON.stringify({
              type: "subscribe",
              organizationId,
              conversationId,
              afterSequence: events.data?.items.at(-1)?.sequence ?? 0,
            }),
          );
        socket.onmessage = () => {
          void queryClient.invalidateQueries({
            queryKey: ["organization", organizationId, "conversation", conversationId],
          });
        };
        socket.onclose = () => {
          if (active) reconnect = window.setTimeout(() => void connect(), 1000);
        };
      } catch {
        /* HTTP remains the history fallback. */
      }
    };
    void connect();
    return () => {
      active = false;
      if (reconnect) window.clearTimeout(reconnect);
      socket?.close();
    };
  }, [conversationId, events.data?.items, organizationId, queryClient, sdk]);
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ["organization", organizationId, "conversation", conversationId],
    });
  const send = useMutation({
    mutationFn: () =>
      sdk.sendChatMessage(
        organizationId,
        conversationId ?? "",
        {
          clientMessageId: crypto.randomUUID(),
          body,
          attachments: JSON.parse(attachments),
          mentionAccountIds: mentions
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        },
        { idempotencyKey: key("message") },
      ),
    onSuccess: async () => {
      setBody("");
      setAttachments("[]");
      setMentions("");
      await refresh();
    },
  });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="resource-detail-drawer chat-detail-drawer">
        <SheetTitle>{detail.data?.title ?? "私聊"}</SheetTitle>
        <div className="resource-detail-drawer-body">
          {messages.isPending ? <ResourceState resourceLabel="消息" state="loading" /> : null}
          {(messages.data?.items ?? []).map((message) => (
            <article className="resource-detail-primary" key={message.id}>
              <strong>
                {message.senderAccountId === accountId ? "我" : message.senderAccountId}
              </strong>
              <p>{message.body ?? "消息已撤回"}</p>
              {message.attachments.length ? (
                <small>{message.attachments.length} 个附件</small>
              ) : null}
              {editing === message.id ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void sdk
                      .editChatMessage(
                        organizationId,
                        conversationId ?? "",
                        message.id,
                        { body: editBody },
                        { idempotencyKey: key("edit") },
                      )
                      .then(refresh);
                    setEditing(null);
                  }}
                >
                  <input
                    aria-label="编辑消息内容"
                    value={editBody}
                    onChange={(event) => setEditBody(event.target.value)}
                  />
                  <Button type="submit">保存</Button>
                </form>
              ) : null}
              <div className="resource-detail-actions">
                <Button
                  variant="quiet"
                  onClick={() =>
                    void sdk
                      .setChatReaction(
                        organizationId,
                        conversationId ?? "",
                        message.id,
                        { emoji: "👍", active: true },
                        { idempotencyKey: key("reaction") },
                      )
                      .then(refresh)
                  }
                >
                  赞
                </Button>
                <Button
                  variant="quiet"
                  onClick={() => {
                    if (window.confirm("确认将这条消息转为任务？"))
                      void sdk.convertChatMessage(
                        organizationId,
                        conversationId ?? "",
                        message.id,
                        {
                          type: "task",
                          title: message.body ?? "聊天任务",
                          assigneeAccountIds: [accountId],
                        },
                        { idempotencyKey: key("convert") },
                      );
                  }}
                >
                  转为任务
                </Button>
                {message.senderAccountId === accountId && message.status === "active" ? (
                  <>
                    <Button
                      variant="quiet"
                      onClick={() => {
                        setEditing(message.id);
                        setEditBody(message.body ?? "");
                      }}
                    >
                      编辑
                    </Button>
                    <Button
                      variant="quiet"
                      onClick={() => {
                        if (window.confirm("确认撤回这条消息？"))
                          void sdk
                            .retractChatMessage(organizationId, conversationId ?? "", message.id, {
                              idempotencyKey: key("retract"),
                            })
                            .then(refresh);
                      }}
                    >
                      撤回
                    </Button>
                  </>
                ) : null}
              </div>
            </article>
          ))}
          <form
            className="resource-sheet-form"
            onSubmit={(event) => {
              event.preventDefault();
              send.mutate();
            }}
          >
            <label>
              消息
              <textarea required value={body} onChange={(event) => setBody(event.target.value)} />
            </label>
            <label>
              附件 JSON
              <input value={attachments} onChange={(event) => setAttachments(event.target.value)} />
            </label>
            <label>
              提到成员（账号 ID，逗号分隔）
              <input value={mentions} onChange={(event) => setMentions(event.target.value)} />
            </label>
            <Button type="submit">
              <Send size={16} />
              发送
            </Button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}
