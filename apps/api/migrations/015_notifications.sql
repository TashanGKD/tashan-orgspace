alter table organizations add column notification_policy_version integer not null default 0
  constraint organizations_notification_policy_version_check check (notification_policy_version >= 0);

create table notification_policy_versions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
  version integer not null constraint notification_policy_versions_number_check check (version > 0),
  timezone text not null, rules jsonb not null constraint notification_policy_rules_check check (jsonb_typeof(rules)='object'),
  published_by_account_id uuid not null references accounts(id), published_at timestamptz not null default now(),
  unique(organization_id,version)
);
create table notification_preferences (
  organization_id uuid not null references organizations(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  daily_summary_enabled boolean not null default true, updated_at timestamptz not null default now(),
  primary key(organization_id,account_id)
);
create table notifications (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
  recipient_account_id uuid not null references accounts(id), event_type text not null,
  title text not null, body text not null, resource_type text, resource_id uuid,
  status text not null default 'unread' constraint notifications_status_check check(status in('unread','read')),
  deduplication_key text not null unique, created_at timestamptz not null default now(), read_at timestamptz
);
create index notifications_recipient_time on notifications(recipient_account_id,status,created_at desc,id);
create table scheduled_reminders (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
  recipient_account_id uuid not null references accounts(id), event_type text not null,
  resource_type text not null, resource_id uuid not null, scheduled_for timestamptz not null,
  status text not null default 'pending' constraint scheduled_reminders_status_check check(status in('pending','processing','done','cancelled')),
  deterministic_key text not null unique, payload jsonb not null constraint scheduled_reminders_payload_check check(jsonb_typeof(payload)='object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index scheduled_reminders_due on scheduled_reminders(status,scheduled_for,id);
create table notification_delivery_attempts (
  id uuid primary key default gen_random_uuid(), notification_id uuid references notifications(id) on delete cascade,
  reminder_id uuid references scheduled_reminders(id) on delete cascade,
  channel text not null constraint notification_delivery_channel_check check(channel in('in_app','sms')),
  status text not null constraint notification_delivery_status_check check(status in('pending','accepted','delivered','failed','unknown')),
  provider_request_id text, provider_biz_id text, idempotency_key text not null unique,
  last_error_code text, attempted_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint notification_delivery_subject_check check((notification_id is not null)::int + (reminder_id is not null)::int = 1)
);
create or replace function reject_notification_policy_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'published notification policy is immutable' using errcode = '55000';
end $$;
create trigger notification_policy_versions_immutable before update or delete on notification_policy_versions
for each row execute function reject_notification_policy_mutation();
grant select,insert on notification_policy_versions to orgspace_app;
grant select,insert,update on notification_preferences,notifications,scheduled_reminders,notification_delivery_attempts to orgspace_app;
