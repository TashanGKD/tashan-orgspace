create table spaces (
  id uuid primary key default gen_random_uuid(),
  type text not null constraint spaces_type_check check (type in ('personal', 'organization')),
  account_id uuid references accounts(id) on delete cascade,
  organization_id uuid references organizations(id) on delete cascade,
  quota_bytes bigint not null constraint spaces_quota_bytes_check check (quota_bytes > 0 and quota_bytes <= 9007199254740991),
  used_bytes bigint not null default 0 constraint spaces_used_bytes_check check (used_bytes >= 0 and used_bytes <= 9007199254740991),
  reserved_bytes bigint not null default 0 constraint spaces_reserved_bytes_check check (reserved_bytes >= 0 and reserved_bytes <= 9007199254740991),
  write_state text not null default 'writable' constraint spaces_write_state_check check (write_state in ('writable', 'quota_readonly')),
  root_folder_id uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint spaces_owner_check check (
    (type = 'personal' and account_id is not null and organization_id is null)
    or (type = 'organization' and organization_id is not null and account_id is null)
  )
);

create unique index spaces_one_personal_per_account on spaces (account_id) where type = 'personal';
create unique index spaces_one_organization_space on spaces (organization_id) where type = 'organization';

create table personal_quota_entitlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  quota_bytes bigint not null constraint personal_quota_entitlements_quota_check
    check (quota_bytes between 53687091200 and 536870912000),
  granted_by_account_id uuid not null references accounts(id),
  status text not null default 'active' constraint personal_quota_entitlements_status_check check (status in ('active', 'revoked')),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personal_quota_entitlements_revoked_check check (
    (status = 'revoked' and revoked_at is not null) or (status = 'active' and revoked_at is null)
  )
);
create unique index personal_quota_entitlements_one_active
  on personal_quota_entitlements (organization_id, account_id) where status = 'active';

create table file_entries (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  parent_id uuid references file_entries(id) deferrable initially deferred,
  kind text not null constraint file_entries_kind_check check (kind in ('file', 'folder')),
  name text not null constraint file_entries_name_check check (length(name) between 1 and 255),
  normalized_name text not null constraint file_entries_normalized_name_check check (length(normalized_name) between 1 and 255),
  created_by_account_id uuid not null references accounts(id),
  current_version_id uuid,
  state text not null default 'active' constraint file_entries_state_check check (state in ('active', 'trash')),
  lock_version integer not null default 1 constraint file_entries_lock_version_check check (lock_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint file_entries_not_self_parent check (parent_id is null or parent_id <> id)
);
create unique index file_entries_active_sibling_name
  on file_entries (space_id, parent_id, normalized_name) where state = 'active';
create index file_entries_parent_list on file_entries (space_id, parent_id, state, normalized_name, id);
create index file_entries_search on file_entries (space_id, normalized_name, updated_at desc, id);

alter table spaces add constraint spaces_root_folder_fk
  foreign key (root_folder_id) references file_entries(id) deferrable initially deferred;

create or replace function enforce_file_entry_parent_space()
returns trigger language plpgsql as $$
declare parent_space uuid;
declare parent_kind text;
begin
  if new.parent_id is null then return new; end if;
  select space_id, kind into parent_space, parent_kind from file_entries where id = new.parent_id;
  if parent_space is null or parent_space <> new.space_id then
    raise exception 'file entry parent must belong to the same space' using errcode = '23514';
  end if;
  if parent_kind <> 'folder' then
    raise exception 'file entry parent must be a folder' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger file_entries_parent_space
before insert or update of parent_id, space_id on file_entries
for each row execute function enforce_file_entry_parent_space();

create table file_versions (
  id uuid primary key default gen_random_uuid(),
  file_entry_id uuid not null references file_entries(id) on delete cascade,
  version_number integer not null constraint file_versions_number_check check (version_number > 0),
  object_key text not null unique constraint file_versions_object_key_check check (object_key ~ '^versions/[0-9a-f-]{36}$'),
  size_bytes bigint not null constraint file_versions_size_check check (size_bytes >= 0 and size_bytes <= 9007199254740991),
  content_type text not null,
  checksum_sha256 text not null constraint file_versions_checksum_check check (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null constraint file_versions_status_check check (status in ('verifying', 'available', 'corrupt')),
  created_by_account_id uuid not null references accounts(id),
  created_at timestamptz not null default now(),
  unique (file_entry_id, version_number)
);
alter table file_entries add constraint file_entries_current_version_fk
  foreign key (current_version_id) references file_versions(id) deferrable initially deferred;

create or replace function enforce_file_version_entry_kind()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from file_entries where id = new.file_entry_id and kind = 'file') then
    raise exception 'file version requires a file entry' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger file_versions_file_kind before insert or update of file_entry_id on file_versions
for each row execute function enforce_file_version_entry_kind();

create table folder_access_policies (
  folder_id uuid primary key references file_entries(id) on delete cascade,
  scope text not null constraint folder_access_policies_scope_check check (scope in ('organization_public', 'restricted')),
  lock_version integer not null default 1 constraint folder_access_policies_version_check check (lock_version > 0),
  updated_by_account_id uuid not null references accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table folder_grants (
  folder_id uuid not null references folder_access_policies(folder_id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  role text not null constraint folder_grants_role_check check (role in ('manager', 'editor', 'viewer')),
  granted_by_account_id uuid not null references accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (folder_id, account_id)
);

create table upload_sessions (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  parent_id uuid not null references file_entries(id),
  target_file_id uuid references file_entries(id),
  created_by_account_id uuid not null references accounts(id),
  file_name text not null,
  normalized_name text not null,
  content_type text not null,
  expected_size_bytes bigint not null constraint upload_sessions_size_check check (expected_size_bytes >= 0 and expected_size_bytes <= 9007199254740991),
  expected_sha256 text,
  temporary_object_key text not null unique constraint upload_sessions_key_check check (temporary_object_key ~ '^temporary/[0-9a-f-]{36}$'),
  s3_upload_id text,
  part_size_bytes bigint not null constraint upload_sessions_part_size_check check (part_size_bytes > 0),
  part_count integer not null constraint upload_sessions_part_count_check check (part_count between 1 and 10000),
  status text not null constraint upload_sessions_status_check check (status in ('created', 'uploading', 'verifying', 'completed', 'cancelled', 'expired', 'failed')),
  expires_at timestamptz not null,
  completed_version_id uuid references file_versions(id),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (created_by_account_id, idempotency_key)
);
create index upload_sessions_expiry on upload_sessions (status, expires_at);
create table upload_parts (
  upload_session_id uuid not null references upload_sessions(id) on delete cascade,
  part_number integer not null constraint upload_parts_number_check check (part_number between 1 and 10000),
  etag text not null,
  checksum_sha256 text not null,
  size_bytes bigint not null constraint upload_parts_size_check check (size_bytes >= 0),
  created_at timestamptz not null default now(),
  primary key (upload_session_id, part_number)
);
create table storage_reservations (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  upload_session_id uuid not null unique references upload_sessions(id) on delete cascade,
  bytes bigint not null constraint storage_reservations_bytes_check check (bytes >= 0),
  status text not null constraint storage_reservations_status_check check (status in ('reserved', 'committed', 'released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table trash_entries (
  entry_id uuid primary key references file_entries(id) on delete cascade,
  original_parent_id uuid references file_entries(id),
  deleted_by_account_id uuid not null references accounts(id),
  deleted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  purge_status text not null default 'pending' constraint trash_entries_status_check check (purge_status in ('pending', 'processing', 'done', 'failed')),
  purge_key text not null unique
);
create index trash_entries_expiry on trash_entries (purge_status, expires_at);
create table file_maintenance_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null constraint file_maintenance_jobs_type_check check (job_type in ('verify_upload', 'expire_upload', 'purge_trash', 'reconcile_version')),
  payload jsonb not null constraint file_maintenance_jobs_payload_check check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending' constraint file_maintenance_jobs_status_check check (status in ('pending', 'processing', 'done', 'dead_letter')),
  attempts integer not null default 0 constraint file_maintenance_jobs_attempts_check check (attempts >= 0),
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint file_maintenance_jobs_lease_check check (
    (lease_owner is null and lease_expires_at is null) or (lease_owner is not null and lease_expires_at is not null)
  )
);
create index file_maintenance_jobs_claim on file_maintenance_jobs (status, available_at, lease_expires_at);

with prepared as (
  select gen_random_uuid() as space_id, gen_random_uuid() as root_id, id as account_id from accounts
), inserted as (
  insert into spaces (id, type, account_id, quota_bytes, root_folder_id)
  select space_id, 'personal', account_id, 53687091200, root_id from prepared
  returning id, account_id, root_folder_id
)
insert into file_entries (id, space_id, kind, name, normalized_name, created_by_account_id)
select root_folder_id, id, 'folder', '.root', '.root', account_id from inserted;

with owners as (
  select o.id as organization_id, o.storage_quota_bytes,
    (select m.account_id from memberships m where m.organization_id = o.id and m.role = 'org_owner' and m.status = 'active' order by m.created_at limit 1) as owner_id
  from organizations o
), prepared as (
  select gen_random_uuid() as space_id, gen_random_uuid() as root_id, * from owners where owner_id is not null
), inserted as (
  insert into spaces (id, type, organization_id, quota_bytes, root_folder_id)
  select space_id, 'organization', organization_id, storage_quota_bytes, root_id from prepared
  returning id, organization_id, root_folder_id
), roots as (
  insert into file_entries (id, space_id, kind, name, normalized_name, created_by_account_id)
  select i.root_folder_id, i.id, 'folder', '.root', '.root', p.owner_id
  from inserted i join prepared p on p.organization_id = i.organization_id
  returning id
)
insert into folder_access_policies (folder_id, scope, updated_by_account_id)
select i.root_folder_id, 'organization_public', p.owner_id
from inserted i join prepared p on p.organization_id = i.organization_id;

grant select, insert, update, delete on
  spaces, personal_quota_entitlements, file_entries, file_versions,
  folder_access_policies, folder_grants, upload_sessions, upload_parts,
  storage_reservations, trash_entries, file_maintenance_jobs
to orgspace_app;
