do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'orgspace_app') then
    create role orgspace_app nologin;
  end if;
end
$$;

create or replace function prevent_audit_events_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_events are append-only' using errcode = '55000';
end
$$;

drop trigger if exists audit_events_append_only on audit_events;
create trigger audit_events_append_only
before update or delete on audit_events
for each statement execute function prevent_audit_events_mutation();

revoke all on audit_events from public;
revoke all on audit_events from orgspace_app;
grant usage on schema public to orgspace_app;
grant select, insert on audit_events to orgspace_app;

grant select, insert, update, delete on
  accounts,
  principals,
  phone_verifications,
  organizations,
  memberships,
  devices,
  sessions,
  idempotency_records,
  outbox_events
to orgspace_app;
