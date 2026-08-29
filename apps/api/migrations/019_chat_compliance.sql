create table chat_message_attachments (
  message_id uuid not null references chat_messages(id) on delete cascade,
  position integer not null constraint chat_message_attachments_position_check check(position>=0),
  attachment_type text not null constraint chat_message_attachments_type_check check(attachment_type in('file','task','meeting','approval')),
  target_id uuid not null,
  space_id uuid references spaces(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(message_id,position),
  unique(message_id,attachment_type,target_id),
  constraint chat_message_attachments_shape_check check(
    (attachment_type='file' and space_id is not null)
    or (attachment_type<>'file' and space_id is null)
  )
);

create table chat_message_conversions (
  message_id uuid not null references chat_messages(id) on delete cascade,
  idempotency_key text not null,
  request_hash text not null constraint chat_message_conversions_hash_check check(request_hash ~ '^[0-9a-f]{64}$'),
  work_item_id uuid not null references work_items(id) on delete cascade,
  created_by_account_id uuid not null references accounts(id),
  created_at timestamptz not null default now(),
  primary key(message_id,idempotency_key)
);

create table chat_compliance_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  requested_by_account_id uuid not null references accounts(id),
  reason text not null constraint chat_compliance_reviews_reason_check check(length(btrim(reason)) between 10 and 2000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint chat_compliance_reviews_window_check check(ends_at>starts_at and ends_at-starts_at<=interval '31 days')
);
create index chat_compliance_reviews_org_time on chat_compliance_reviews(organization_id,created_at desc,id);

grant select,insert,update,delete on chat_message_attachments,chat_message_conversions to orgspace_app;
grant select,insert on chat_compliance_reviews to orgspace_app;
