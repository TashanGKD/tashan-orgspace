alter table chat_events add column global_position bigint generated always as identity;
create unique index chat_events_global_position on chat_events(global_position);
