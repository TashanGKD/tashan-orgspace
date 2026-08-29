create table process_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null constraint process_definitions_name_check check (length(btrim(name)) between 1 and 200),
  created_by_account_id uuid not null references accounts(id),
  version integer not null default 1 constraint process_definitions_version_check check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table process_definition_versions (
  id uuid primary key default gen_random_uuid(),
  definition_id uuid not null references process_definitions(id) on delete cascade,
  version_number integer not null constraint process_definition_versions_number_check check (version_number > 0),
  mode text not null constraint process_definition_versions_mode_check check (mode in ('single', 'sequence', 'any', 'all')),
  status text not null default 'draft' constraint process_definition_versions_status_check check (status in ('draft', 'published')),
  created_by_account_id uuid not null references accounts(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (definition_id, version_number),
  constraint process_definition_versions_published_check check (
    (status = 'draft' and published_at is null) or (status = 'published' and published_at is not null)
  )
);

create table process_definition_steps (
  id uuid primary key default gen_random_uuid(),
  definition_version_id uuid not null references process_definition_versions(id) on delete cascade,
  position integer not null constraint process_definition_steps_position_check check (position > 0),
  approver_account_id uuid not null references accounts(id),
  created_at timestamptz not null default now(),
  unique (definition_version_id, position),
  unique (definition_version_id, approver_account_id)
);

create table process_instances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  definition_version_id uuid not null references process_definition_versions(id),
  initiator_account_id uuid not null references accounts(id),
  subject jsonb not null constraint process_instances_subject_check check (jsonb_typeof(subject) = 'object'),
  status text not null default 'pending' constraint process_instances_status_check check (
    status in ('pending', 'approved', 'rejected', 'returned', 'withdrawn')
  ),
  version integer not null default 1 constraint process_instances_version_check check (version > 0),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint process_instances_completed_check check (
    (status = 'pending' and completed_at is null) or (status <> 'pending' and completed_at is not null)
  )
);

create table process_instance_steps (
  id uuid primary key default gen_random_uuid(),
  process_instance_id uuid not null references process_instances(id) on delete cascade,
  position integer not null constraint process_instance_steps_position_check check (position > 0),
  approver_account_id uuid not null references accounts(id),
  transferred_from_account_id uuid references accounts(id),
  status text not null constraint process_instance_steps_status_check check (
    status in ('waiting', 'pending', 'approved', 'rejected', 'returned', 'skipped')
  ),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (process_instance_id, position)
);
create index process_instance_steps_approver_status
  on process_instance_steps (approver_account_id, status, updated_at, id);

create table process_decision_events (
  id uuid primary key default gen_random_uuid(),
  process_instance_id uuid not null references process_instances(id) on delete cascade,
  step_id uuid references process_instance_steps(id),
  actor_account_id uuid not null references accounts(id),
  action text not null constraint process_decision_events_action_check check (
    action in ('approve', 'reject', 'return', 'withdraw', 'transfer')
  ),
  reason text,
  target_account_id uuid references accounts(id),
  instance_version integer not null constraint process_decision_events_version_check check (instance_version > 1),
  created_at timestamptz not null default now()
);
create index process_decision_events_instance_time
  on process_decision_events (process_instance_id, created_at, id);

create or replace function reject_published_process_version_mutation()
returns trigger language plpgsql as $$
begin
  if old.status = 'published' then
    raise exception 'published process versions are immutable' using errcode = '55000';
  end if;
  return new;
end $$;
create trigger process_definition_versions_immutable
before update or delete on process_definition_versions
for each row execute function reject_published_process_version_mutation();

create or replace function reject_published_process_step_mutation()
returns trigger language plpgsql as $$
declare version_status text;
begin
  select status into version_status from process_definition_versions
    where id = coalesce(new.definition_version_id, old.definition_version_id);
  if version_status = 'published' then
    raise exception 'published process versions are immutable' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;
create trigger process_definition_steps_immutable
before insert or update or delete on process_definition_steps
for each row execute function reject_published_process_step_mutation();

create trigger process_decision_events_append_only
before update or delete on process_decision_events
for each row execute function reject_collaboration_event_mutation();

grant select, insert, update, delete on
  process_definitions, process_definition_versions, process_definition_steps,
  process_instances, process_instance_steps, process_decision_events
to orgspace_app;
