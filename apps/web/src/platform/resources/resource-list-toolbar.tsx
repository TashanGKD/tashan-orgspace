import { Grid2X2, List, Search } from "lucide-react";

import { Button } from "../../design-system/primitives/index.js";

export type ResourceFilter = Readonly<{ id: string; label: string }>;
export type ResourceView = "list" | "grid";

export function ResourceListToolbar({
  activeFilter,
  filters,
  onFilterChange,
  onQueryChange,
  onViewChange,
  query,
  resourceLabel,
  view,
}: {
  activeFilter: string;
  filters: readonly ResourceFilter[];
  onFilterChange(filterId: string): void;
  onQueryChange(query: string): void;
  onViewChange(view: ResourceView): void;
  query: string;
  resourceLabel: string;
  view: ResourceView;
}) {
  return (
    <div className="resource-list-toolbar">
      <label className="resource-search">
        <Search aria-hidden size={16} />
        <span className="sr-only">搜索{resourceLabel}</span>
        <input
          aria-label={`搜索${resourceLabel}`}
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
        />
      </label>
      <div aria-label={`${resourceLabel}筛选`} className="resource-filter-chips" role="group">
        {filters.map((filter) => (
          <Button
            aria-pressed={filter.id === activeFilter}
            key={filter.id}
            size="small"
            variant="quiet"
            onClick={() => onFilterChange(filter.id)}
          >
            {filter.label}
          </Button>
        ))}
      </div>
      <div aria-label="视图" className="resource-view-toggle" role="group">
        <Button
          aria-label="列表视图"
          aria-pressed={view === "list"}
          size="small"
          variant="quiet"
          onClick={() => onViewChange("list")}
        >
          <List aria-hidden size={16} />
        </Button>
        <Button
          aria-label="网格视图"
          aria-pressed={view === "grid"}
          size="small"
          variant="quiet"
          onClick={() => onViewChange("grid")}
        >
          <Grid2X2 aria-hidden size={15} />
        </Button>
      </div>
    </div>
  );
}
