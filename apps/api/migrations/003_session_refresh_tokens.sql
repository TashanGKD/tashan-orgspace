create table session_refresh_tokens (
  token_hash text primary key,
  session_id uuid not null references sessions(id),
  token_version integer not null constraint session_refresh_tokens_version_check check (token_version > 0),
  status text not null default 'active' constraint session_refresh_tokens_status_check check (status in ('active', 'rotated', 'revoked')),
  replaced_by_hash text,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index session_refresh_tokens_session_lookup
  on session_refresh_tokens (session_id, status, created_at);

insert into session_refresh_tokens (token_hash, session_id, token_version, status)
select refresh_token_hash, id, token_version, case when revoked_at is null then 'active' else 'revoked' end
from sessions
on conflict (token_hash) do nothing;

grant select, insert, update, delete on session_refresh_tokens to orgspace_app;
