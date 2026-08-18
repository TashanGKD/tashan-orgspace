alter table idempotency_records add column actor_key text;

update idempotency_records
set actor_key = 'principal:' || actor_principal_id::text;

alter table idempotency_records alter column actor_key set not null;
alter table idempotency_records alter column actor_principal_id drop not null;
alter table idempotency_records
  drop constraint idempotency_records_actor_principal_id_capability_id_idempo_key;

create unique index idempotency_records_actor_key_capability_key
  on idempotency_records (actor_key, capability_id, idempotency_key);

alter table idempotency_records add constraint idempotency_records_actor_key_check
  check (length(actor_key) between 1 and 512 and actor_key !~ '[\r\n\x00]');
