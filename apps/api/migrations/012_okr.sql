create table okr_objectives (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  owner_account_id uuid not null references accounts(id),
  title text not null constraint okr_objectives_title_check check (length(btrim(title)) between 1 and 200),
  cycle text not null constraint okr_objectives_cycle_check check (length(btrim(cycle)) between 1 and 100),
  progress numeric(7,4) not null default 0 constraint okr_objectives_progress_check check (progress between 0 and 100),
  version integer not null default 1 constraint okr_objectives_version_check check (version > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index okr_objectives_org_cycle on okr_objectives (organization_id, cycle, created_at, id);

create table okr_key_results (
  id uuid primary key default gen_random_uuid(),
  objective_id uuid not null references okr_objectives(id) on delete cascade,
  title text not null constraint okr_key_results_title_check check (length(btrim(title)) between 1 and 200),
  weight integer not null constraint okr_key_results_weight_check check (weight between 1 and 100),
  formula jsonb not null constraint okr_key_results_formula_check check (jsonb_typeof(formula) = 'object'),
  formula_version integer not null default 1 constraint okr_key_results_formula_version_check check (formula_version > 0),
  progress numeric(7,4) not null default 0 constraint okr_key_results_progress_check check (progress between 0 and 100),
  version integer not null default 1 constraint okr_key_results_version_check check (version > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table okr_progress_events (
  id uuid primary key default gen_random_uuid(), key_result_id uuid not null references okr_key_results(id) on delete cascade,
  actor_account_id uuid not null references accounts(id), formula_version integer not null,
  input_snapshot jsonb not null constraint okr_progress_events_snapshot_check check (jsonb_typeof(input_snapshot) = 'object'),
  progress numeric(7,4) not null constraint okr_progress_events_progress_check check (progress between 0 and 100),
  created_at timestamptz not null default now()
);

create table okr_change_requests (
  id uuid primary key default gen_random_uuid(), objective_id uuid not null references okr_objectives(id) on delete cascade,
  work_item_id uuid not null unique references work_items(id) on delete cascade,
  requested_by_account_id uuid not null references accounts(id), patch jsonb not null constraint okr_change_requests_patch_check check (jsonb_typeof(patch) = 'object'),
  status text not null default 'pending' constraint okr_change_requests_status_check check (status in ('pending', 'approved', 'rejected')),
  decided_by_account_id uuid references accounts(id), created_at timestamptz not null default now(), decided_at timestamptz
);

create trigger okr_progress_events_append_only before update or delete on okr_progress_events
for each row execute function reject_collaboration_event_mutation();
grant select, insert, update, delete on okr_objectives, okr_key_results, okr_progress_events, okr_change_requests to orgspace_app;
