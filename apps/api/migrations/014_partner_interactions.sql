alter table collaboration_resources drop constraint collaboration_resources_type_check;
alter table collaboration_resources add constraint collaboration_resources_type_check check (
  resource_type in ('file','folder','work_item','process_instance','objective','key_result','partner','partner_interaction','conversation','message','member')
);

create table partner_interactions (
  id uuid primary key default gen_random_uuid(), partner_id uuid not null references partners(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  contacted_at timestamptz not null, channel text not null constraint partner_interactions_channel_check check (channel in ('phone','wechat','email','in_person','meeting','other')),
  summary text not null constraint partner_interactions_summary_check check (length(btrim(summary)) between 1 and 20000),
  recorded_by_account_id uuid not null references accounts(id), requires_follow_up boolean not null default false,
  next_follow_up_at timestamptz, corrects_interaction_id uuid references partner_interactions(id), follow_up_work_item_id uuid references work_items(id),
  idempotency_key text not null, request_hash text not null constraint partner_interactions_hash_check check (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(), unique(partner_id,idempotency_key)
);
create index partner_interactions_partner_time on partner_interactions(partner_id,contacted_at desc,id);
create trigger partner_interactions_append_only before update or delete on partner_interactions for each row execute function reject_collaboration_event_mutation();
grant select,insert on partner_interactions to orgspace_app;
