create table partners (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
  owner_account_id uuid not null references accounts(id), created_by_account_id uuid not null references accounts(id),
  name text not null constraint partners_name_check check (length(btrim(name)) between 1 and 200),
  organization_name text, department text, job_title text,
  address_cipher jsonb, phone_cipher jsonb, wechat_cipher jsonb, email_cipher jsonb,
  phone_blind_index text, wechat_blind_index text, email_blind_index text,
  cooperation_stage text not null constraint partners_stage_check check (cooperation_stage in ('lead','contacting','active','paused','ended')),
  tags text[] not null default '{}', notes text, last_contact_at timestamptz, next_follow_up_at timestamptz,
  record_state text not null default 'active' constraint partners_state_check check (record_state in ('active','archived','awaiting_owner')),
  version integer not null default 1 constraint partners_version_check check (version > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index partners_owner_state on partners (organization_id, owner_account_id, record_state, updated_at desc, id);
create index partners_phone_blind on partners (organization_id, phone_blind_index) where phone_blind_index is not null;
create index partners_wechat_blind on partners (organization_id, wechat_blind_index) where wechat_blind_index is not null;
create index partners_email_blind on partners (organization_id, email_blind_index) where email_blind_index is not null;
grant select, insert, update, delete on partners to orgspace_app;
