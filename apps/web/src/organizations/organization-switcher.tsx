import { useState, type FormEvent } from "react";

interface OrganizationItem {
  id: string;
  name: string;
}

interface OrganizationSwitcherProps {
  items: OrganizationItem[];
  selectedId: string;
  busy: boolean;
  onSelect: (organizationId: string) => void;
  onCreate: (name: string) => Promise<void>;
}

export function OrganizationSwitcher({
  items,
  selectedId,
  busy,
  onSelect,
  onCreate,
}: OrganizationSwitcherProps) {
  const [name, setName] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await onCreate(name);
    setName("");
  }

  return (
    <section className="workspace-card organization-card" aria-labelledby="organization-title">
      <div className="card-heading">
        <div>
          <p className="section-index">01 / ORGANIZATION</p>
          <h2 id="organization-title">组织</h2>
        </div>
        <span className="count-mark">{String(items.length).padStart(2, "0")}</span>
      </div>
      <label>
        当前组织
        <select value={selectedId} onChange={(event) => onSelect(event.target.value)}>
          {items.length === 0 ? <option value="">尚未加入组织</option> : null}
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <form className="inline-form" onSubmit={(event) => void submit(event)}>
        <label>
          新组织名称
          <input
            maxLength={128}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button disabled={busy} type="submit">
          {busy ? "正在创建…" : "创建组织"}
        </button>
      </form>
      <p className="field-note">组织空间默认额度 500 GB；创建者成为组织负责人。</p>
    </section>
  );
}
