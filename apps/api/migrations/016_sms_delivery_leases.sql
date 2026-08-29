alter table notification_delivery_attempts
  add column attempts integer not null default 0,
  add column available_at timestamptz not null default now(),
  add column lease_owner text,
  add column lease_expires_at timestamptz,
  add constraint notification_delivery_lease_check check (
    (lease_owner is null and lease_expires_at is null)
    or (lease_owner is not null and lease_expires_at is not null)
  );
create index notification_delivery_claim on notification_delivery_attempts(status,available_at,lease_expires_at,id);
