create extension if not exists pgcrypto;
create extension if not exists citext;

create table accounts (
  id uuid primary key default gen_random_uuid(),
  username citext not null unique,
  password_hash text not null,
  phone_e164 text unique,
  phone_verified_at timestamptz,
  status text not null default 'active' constraint accounts_status_check check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounts_phone_e164_check check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint accounts_phone_verified_check check (phone_verified_at is null or phone_e164 is not null)
);

create table principals (
  id uuid primary key default gen_random_uuid(),
  account_id uuid unique references accounts(id),
  type text not null constraint principals_type_check check (type in ('human', 'system', 'ai_employee', 'service_account')),
  created_at timestamptz not null default now(),
  constraint principals_account_type_check check (
    (type = 'human' and account_id is not null)
    or (type in ('system', 'ai_employee', 'service_account') and account_id is null)
  )
);

create table phone_verifications (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id),
  phone_e164 text not null constraint phone_verifications_phone_check check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  code_hash text not null,
  attempts integer not null default 0 constraint phone_verifications_attempts_check check (attempts between 0 and 5),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index phone_verifications_active_lookup
  on phone_verifications (account_id, phone_e164, expires_at)
  where consumed_at is null;

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active' constraint organizations_status_check check (status in ('active', 'suspended', 'closed')),
  storage_quota_bytes bigint not null default 536870912000 constraint organizations_quota_check check (storage_quota_bytes > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  account_id uuid not null references accounts(id),
  role text not null constraint memberships_role_check check (role in ('org_owner', 'org_admin', 'member')),
  status text not null default 'active' constraint memberships_status_check check (status in ('active', 'suspended', 'removed')),
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memberships_removed_state_check check (
    (status = 'removed' and removed_at is not null)
    or (status <> 'removed' and removed_at is null)
  )
);

create unique index memberships_one_active_per_account
  on memberships (organization_id, account_id)
  where status <> 'removed';

create table devices (
  id uuid primary key,
  account_id uuid not null references accounts(id),
  name text not null,
  os text not null,
  architecture text not null,
  client_version text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index devices_account_lookup on devices (account_id, revoked_at);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id),
  principal_id uuid not null references principals(id),
  device_id uuid not null references devices(id),
  refresh_token_hash text not null unique,
  token_version integer not null default 1 constraint sessions_token_version_check check (token_version > 0),
  client_channel text not null constraint sessions_client_channel_check check (client_channel in ('web', 'cli')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sessions_account_device_lookup on sessions (account_id, device_id, revoked_at);

create table idempotency_records (
  id uuid primary key default gen_random_uuid(),
  actor_principal_id uuid not null references principals(id),
  capability_id text not null,
  idempotency_key text not null,
  request_hash text not null,
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (actor_principal_id, capability_id, idempotency_key)
);

create table outbox_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  payload jsonb not null constraint outbox_events_payload_check check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending' constraint outbox_events_status_check check (status in ('pending', 'processing', 'done', 'dead_letter')),
  attempts integer not null default 0 constraint outbox_events_attempts_check check (attempts >= 0),
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outbox_events_lease_check check (
    (lease_owner is null and lease_expires_at is null)
    or (lease_owner is not null and lease_expires_at is not null)
  )
);

create index outbox_events_claim_lookup on outbox_events (status, available_at, lease_expires_at);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id),
  account_id uuid references accounts(id),
  principal_id uuid references principals(id),
  session_id uuid references sessions(id),
  device_id uuid references devices(id),
  server_ip inet not null,
  proxy_chain jsonb not null default '[]'::jsonb constraint audit_events_proxy_chain_check check (jsonb_typeof(proxy_chain) = 'array'),
  device_metadata jsonb constraint audit_events_device_metadata_check check (device_metadata is null or jsonb_typeof(device_metadata) = 'object'),
  actor_source text not null constraint audit_events_actor_source_check check (actor_source in ('web', 'cli', 'ai_via_cli', 'system')),
  capability_id text not null,
  action text not null,
  object_type text,
  object_id text,
  result text not null constraint audit_events_result_check check (result in ('success', 'rejected', 'failure')),
  error_code text,
  request_id uuid not null,
  idempotency_key text,
  before_state jsonb constraint audit_events_before_state_check check (before_state is null or jsonb_typeof(before_state) = 'object'),
  after_state jsonb constraint audit_events_after_state_check check (after_state is null or jsonb_typeof(after_state) = 'object'),
  prev_hash text,
  event_hash text not null,
  created_at timestamptz not null default now()
);

create index audit_events_organization_time on audit_events (organization_id, created_at, id);
create index audit_events_account_time on audit_events (account_id, created_at, id);
