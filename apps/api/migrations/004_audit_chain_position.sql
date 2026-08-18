alter table audit_events disable trigger audit_events_append_only;

alter table audit_events add column reported_actor_source text;
alter table audit_events add column chain_position bigint;

with ranked as (
  select
    id,
    row_number() over (partition by organization_id order by created_at, id) as position
  from audit_events
)
update audit_events
set chain_position = ranked.position
from ranked
where audit_events.id = ranked.id;

alter table audit_events alter column chain_position set not null;
alter table audit_events add constraint audit_events_chain_position_check check (chain_position > 0);

create unique index audit_events_organization_chain_position
  on audit_events (organization_id, chain_position)
  where organization_id is not null;

create unique index audit_events_platform_chain_position
  on audit_events (chain_position)
  where organization_id is null;

alter table audit_events enable trigger audit_events_append_only;
