create table conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  kind text not null constraint conversations_kind_check check(kind in('direct','group')),
  title text constraint conversations_title_check check(title is null or length(btrim(title)) between 1 and 200),
  direct_key text,
  created_by_account_id uuid not null references accounts(id),
  next_sequence bigint not null default 0 constraint conversations_sequence_check check(next_sequence>=0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint conversations_shape_check check(
    (kind='direct' and direct_key is not null and title is null)
    or (kind='group' and direct_key is null and title is not null)
  )
);
create unique index conversations_direct_pair on conversations(organization_id,direct_key) where kind='direct';
create index conversations_organization_time on conversations(organization_id,updated_at desc,id);

create table conversation_members (
  conversation_id uuid not null references conversations(id) on delete cascade,
  account_id uuid not null references accounts(id),
  role text not null default 'member' constraint conversation_members_role_check check(role in('owner','member')),
  joined_at timestamptz not null default now(), left_at timestamptz,
  primary key(conversation_id,account_id)
);
create index conversation_members_account on conversation_members(account_id,left_at,conversation_id);

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_account_id uuid not null references accounts(id),
  client_message_id uuid not null,
  client_payload_hash text not null constraint chat_messages_hash_check check(client_payload_hash ~ '^[0-9a-f]{64}$'),
  sequence bigint not null constraint chat_messages_sequence_check check(sequence>0),
  body text constraint chat_messages_body_check check(body is null or length(btrim(body)) between 1 and 20000),
  reply_to_message_id uuid,
  status text not null default 'active' constraint chat_messages_status_check check(status in('active','retracted')),
  edited_at timestamptz, retracted_at timestamptz, created_at timestamptz not null default now(),
  unique(conversation_id,client_message_id), unique(conversation_id,sequence), unique(conversation_id,id),
  foreign key(conversation_id,reply_to_message_id) references chat_messages(conversation_id,id),
  constraint chat_messages_status_shape check(
    (status='active' and body is not null and retracted_at is null)
    or (status='retracted' and body is null and retracted_at is not null)
  )
);
create index chat_messages_history on chat_messages(conversation_id,sequence,id);

create table chat_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sequence bigint not null constraint chat_events_sequence_check check(sequence>0),
  event_type text not null constraint chat_events_type_check check(event_type in(
    'message.sent','message.edited','message.retracted','reaction.added','reaction.removed'
  )),
  message_id uuid not null,
  actor_account_id uuid not null references accounts(id),
  payload jsonb not null constraint chat_events_payload_check check(jsonb_typeof(payload)='object'),
  created_at timestamptz not null default now(),
  unique(conversation_id,sequence),
  foreign key(conversation_id,message_id) references chat_messages(conversation_id,id) on delete cascade
);
create index chat_events_history on chat_events(conversation_id,sequence,id);

create table chat_reactions (
  conversation_id uuid not null,
  message_id uuid not null,
  account_id uuid not null references accounts(id),
  emoji text not null constraint chat_reactions_emoji_check check(length(emoji) between 1 and 32),
  created_at timestamptz not null default now(),
  primary key(message_id,account_id,emoji),
  foreign key(conversation_id,message_id) references chat_messages(conversation_id,id) on delete cascade
);

create or replace function reject_chat_event_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'chat events are append-only' using errcode='55000';
end $$;
create trigger chat_events_append_only before update or delete on chat_events
for each row execute function reject_chat_event_mutation();

grant select,insert,update,delete on conversations,conversation_members,chat_messages,chat_reactions to orgspace_app;
grant select,insert on chat_events to orgspace_app;
