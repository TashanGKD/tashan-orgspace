import type { ButtonProps } from "../../design-system/primitives/button.js";
import { Button } from "../../design-system/primitives/index.js";

export type ResourceAction = Readonly<{
  id: string;
  label: string;
  onAction(): void;
  tone?: Extract<ButtonProps["variant"], "primary" | "secondary" | "danger">;
}>;

export function ResourceActionBar({
  actions,
  mode = "ready",
}: {
  actions: readonly ResourceAction[];
  mode?: "ready" | "readonly" | "version-conflict";
}) {
  if (mode === "version-conflict") {
    return (
      <div className="resource-action-conflict" role="alert">
        内容已经更新，请刷新后再操作
      </div>
    );
  }
  return (
    <div aria-label="资源操作" className="resource-action-bar" role="group">
      {actions.map((action) => (
        <Button
          disabled={mode === "readonly"}
          key={action.id}
          variant={action.tone ?? "primary"}
          onClick={action.onAction}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}
