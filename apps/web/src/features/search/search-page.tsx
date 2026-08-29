import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState } from "react";
import type { OrgSpaceClient } from "@tashan/sdk";
import { Button } from "../../design-system/primitives/index.js";
import { ResourceListPage } from "../../platform/resources/resource-list-page.js";
import { ResourceRow } from "../../platform/resources/resource-row.js";
import { ResourceState } from "../../platform/resources/resource-states.js";

const typeLabel = {
  file: "文件",
  work_item: "工作",
  objective: "OKR",
  partner: "合作方",
  member: "成员",
  message: "消息",
} as const;
export function SearchPage({
  organizationId,
  sdk,
}: {
  organizationId: string;
  sdk: OrgSpaceClient;
}) {
  const [input, setInput] = useState(""),
    [query, setQuery] = useState("");
  const result = useQuery({
    enabled: query.length >= 2,
    queryKey: ["organization", organizationId, "search", query],
    queryFn: ({ signal }) => sdk.searchOrganization(organizationId, { query }, signal),
  });
  return (
    <ResourceListPage
      title="搜索"
      description="搜索你有权限查看的组织内容"
      toolbar={
        <form
          className="resource-list-toolbar"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(input.trim());
          }}
        >
          <label>
            搜索内容
            <input
              required
              minLength={2}
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
          </label>
          <Button type="submit">
            <Search size={16} />
            搜索
          </Button>
        </form>
      }
    >
      {!query ? (
        <p>输入至少两个字符开始搜索。</p>
      ) : result.isPending ? (
        <ResourceState resourceLabel="搜索结果" state="loading" />
      ) : result.isError ? (
        <ResourceState resourceLabel="搜索结果" state="fatal-error" />
      ) : result.data?.totalAuthorized === 0 ? (
        <ResourceState resourceLabel="搜索结果" state="empty" />
      ) : (
        (result.data?.groups ?? [])
          .flatMap((group) => group.items)
          .map((item) => (
            <ResourceRow
              key={`${item.type}:${item.resource.resourceId}`}
              href={item.href}
              leading={<Search size={18} />}
              title={item.title}
              metadata={[item.snippet]}
              status={{ label: typeLabel[item.type], tone: "neutral" }}
            />
          ))
      )}
    </ResourceListPage>
  );
}
