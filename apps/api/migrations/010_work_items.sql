create table work_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  type text not null constraint work_items_type_check check (
    type in ('task', 'meeting', 'approval', 'change_request')
  ),
  title text not null constraint work_items_title_check check (length(btrim(title)) between 1 and 200),
  description text not null default '' constraint work_items_description_check check (length(description) <= 20000),
  priority text not null default 'normal' constraint work_items_priority_check check (priority in ('normal', 'urgent')),
  status text not null default 'open' constraint work_items_status_check check (status in ('open', 'completed', 'cancelled')),
  due_at timestamptz,
  meeting_starts_at timestamptz,
  created_by_account_id uuid not null references accounts(id),
  version integer not null default 1 constraint work_items_version_check check (version > 0),
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_items_meeting_time_check check (type <> 'meeting' or meeting_starts_at is not null),
  constraint work_items_terminal_time_check check (
    (status = 'open' and completed_at is null and cancelled_at is null)
    or (status = 'completed' and completed_at is not null and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null and completed_at is null)
  )
);
create index work_items_organization_status_due
  on work_items (organization_id, status, due_at, created_at, id);

create table work_assignments (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references work_items(id) on delete cascade,
  assignee_account_id uuid not null references accounts(id),
  assigned_by_account_id uuid not null references accounts(id),
  status text not null default 'assigned' constraint work_assignments_status_check check (
    status in ('assigned', 'disputed', 'transfer_pending')
  ),
  dispute_reason text,
  transfer_target_account_id uuid references accounts(id),
  transfer_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (work_item_id, assignee_account_id),
  constraint work_assignments_transfer_check check (
    (status = 'transfer_pending' and transfer_target_account_id is not null and length(btrim(transfer_reason)) > 0)
    or (status <> 'transfer_pending' and transfer_target_account_id is null and transfer_reason is null)
  ),
  constraint work_assignments_dispute_check check (
    (status = 'disputed' and length(btrim(dispute_reason)) > 0)
    or (status <> 'disputed')
  )
);
create index work_assignments_assignee_status
  on work_assignments (assignee_account_id, status, updated_at, id);

grant select, insert, update, delete on work_items, work_assignments to orgspace_app;
