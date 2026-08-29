create table collaboration_resources (
  organization_id uuid not null references organizations(id) on delete cascade,
  resource_type text not null constraint collaboration_resources_type_check check (
    resource_type in (
      'file', 'folder', 'work_item', 'process_instance', 'objective', 'key_result',
      'partner', 'conversation', 'message', 'member'
    )
  ),
  resource_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (resource_type, resource_id),
  unique (organization_id, resource_type, resource_id)
);

create table resource_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  source_type text not null,
  source_id uuid not null,
  target_type text not null,
  target_id uuid not null,
  relation_type text not null constraint resource_links_relation_check check (
    relation_type ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$' and length(relation_type) <= 64
  ),
  created_by_account_id uuid not null references accounts(id),
  created_at timestamptz not null default now(),
  constraint resource_links_not_self check (
    source_type <> target_type or source_id <> target_id
  ),
  foreign key (organization_id, source_type, source_id)
    references collaboration_resources (organization_id, resource_type, resource_id) on delete cascade,
  foreign key (organization_id, target_type, target_id)
    references collaboration_resources (organization_id, resource_type, resource_id) on delete cascade,
  constraint resource_links_unique
    unique (organization_id, source_type, source_id, target_type, target_id, relation_type)
);
create index resource_links_target_lookup
  on resource_links (organization_id, target_type, target_id, created_at, id);

create table collaboration_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  resource_type text not null,
  resource_id uuid not null,
  body text not null constraint collaboration_comments_body_check check (
    length(btrim(body)) between 1 and 20000
  ),
  author_account_id uuid not null references accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, resource_type, resource_id)
    references collaboration_resources (organization_id, resource_type, resource_id) on delete cascade
);
create index collaboration_comments_resource_time
  on collaboration_comments (organization_id, resource_type, resource_id, created_at, id);

create table activity_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  resource_type text not null,
  resource_id uuid not null,
  event_type text not null constraint activity_events_type_check check (
    event_type ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)+$' and length(event_type) <= 128
  ),
  schema_version integer not null constraint activity_events_schema_check check (schema_version > 0),
  actor_account_id uuid references accounts(id),
  payload jsonb not null constraint activity_events_payload_check check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (organization_id, resource_type, resource_id)
    references collaboration_resources (organization_id, resource_type, resource_id) on delete cascade
);
create index activity_events_resource_time
  on activity_events (organization_id, resource_type, resource_id, created_at, id);

create table domain_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  aggregate_type text not null,
  aggregate_id uuid not null,
  sequence bigint not null constraint domain_events_sequence_check check (sequence > 0),
  event_type text not null constraint domain_events_type_check check (
    event_type ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)+$' and length(event_type) <= 128
  ),
  schema_version integer not null constraint domain_events_schema_check check (schema_version > 0),
  actor_account_id uuid references accounts(id),
  payload jsonb not null constraint domain_events_payload_check check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (organization_id, aggregate_type, aggregate_id)
    references collaboration_resources (organization_id, resource_type, resource_id) on delete cascade,
  unique (aggregate_type, aggregate_id, sequence)
);
create index domain_events_organization_time
  on domain_events (organization_id, created_at, id);

create or replace function reject_collaboration_event_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'collaboration events are append-only' using errcode = '55000';
end $$;

create trigger activity_events_append_only
before update or delete on activity_events
for each row execute function reject_collaboration_event_mutation();

create trigger domain_events_append_only
before update or delete on domain_events
for each row execute function reject_collaboration_event_mutation();

grant select, insert, update, delete on
  collaboration_resources, resource_links, collaboration_comments, activity_events, domain_events
to orgspace_app;
