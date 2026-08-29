create view search_resource_catalog as
select space.organization_id, 'file'::text resource_type, entry.id resource_id, null::text resource_subtype,
  entry.name title, entry.name content, entry.updated_at, space.id authorization_scope_id,
  null::uuid owner_account_id
from file_entries entry join spaces space on space.id=entry.space_id
where space.type='organization' and entry.state='active'
union all
select item.organization_id, 'work_item', item.id, item.type, item.title,
  concat_ws(' ',item.title,item.description,item.type,item.status), item.updated_at, null::uuid, null::uuid
from work_items item
union all
select objective.organization_id, 'objective', objective.id, null::text, objective.title,
  concat_ws(' ',objective.title,objective.cycle), objective.updated_at, null::uuid, objective.owner_account_id
from okr_objectives objective
union all
select partner.organization_id, 'partner', partner.id, null::text, partner.name,
  concat_ws(' ',partner.name,partner.organization_name,array_to_string(partner.tags,' ')),
  partner.updated_at, null::uuid, partner.owner_account_id
from partners partner where partner.record_state<>'archived'
union all
select membership.organization_id, 'member', membership.id, null::text, account.display_name,
  concat_ws(' ',account.display_name,membership.role), membership.updated_at, null::uuid, membership.account_id
from memberships membership join accounts account on account.id=membership.account_id
where membership.status='active'
union all
select conversation.organization_id, 'message', message.id, null::text,
  left(message.body,200), message.body, message.created_at, conversation.id, message.sender_account_id
from chat_messages message join conversations conversation on conversation.id=message.conversation_id
where message.status='active';

grant select on search_resource_catalog to orgspace_app;
