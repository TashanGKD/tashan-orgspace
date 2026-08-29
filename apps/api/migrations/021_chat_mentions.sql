create table chat_mentions (
  message_id uuid not null references chat_messages(id) on delete cascade,
  mentioned_account_id uuid not null references accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(message_id,mentioned_account_id)
);
create index chat_mentions_account_time on chat_mentions(mentioned_account_id,created_at desc,message_id);
grant select,insert,delete on chat_mentions to orgspace_app;
