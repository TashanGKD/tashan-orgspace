do $$
begin
  if exists (select 1 from phone_verifications) then
    raise exception 'legacy phone verification challenges must expire before migration';
  end if;
end $$;

alter table accounts add column display_name text;

update accounts
set display_name = '用户' || right(phone_e164, 4)
where phone_e164 is not null and phone_verified_at is not null;

do $$
begin
  if exists (
    select 1
    from accounts
    where phone_e164 is null or phone_verified_at is null or display_name is null
  ) then
    raise exception 'legacy accounts require explicit phone mapping';
  end if;
end $$;

alter table accounts alter column phone_e164 set not null;
alter table accounts alter column phone_verified_at set not null;
alter table accounts alter column display_name set not null;
alter table accounts drop column username;

drop index phone_verifications_active_lookup;
alter table phone_verifications alter column account_id drop not null;
alter table phone_verifications add column purpose text not null;
alter table phone_verifications add constraint phone_verifications_purpose_check
  check (purpose in ('register', 'password_reset'));
alter table phone_verifications add column request_id uuid not null;
alter table phone_verifications add column server_ip inet not null;
alter table phone_verifications add column delivery_result text not null;

create index phone_verifications_active_lookup
  on phone_verifications (phone_e164, purpose, expires_at)
  where consumed_at is null;
