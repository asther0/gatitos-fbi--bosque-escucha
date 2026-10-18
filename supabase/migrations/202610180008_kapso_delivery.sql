-- Preserve existing dispatch reservations while replacing the provider.
-- Historical migration 006 remains applied; do not recreate its rows.
alter table public.be_zavu_dispatches rename to be_kapso_dispatches;
alter table public.be_zavu_receipts rename to be_kapso_receipts;
alter function public.be_reserve_zavu(uuid) rename to be_reserve_kapso;
alter function public.be_zavu_receipt(text,text,text) rename to be_kapso_receipt;

create or replace function public.be_reserve_kapso(target uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare n be_notifications; i be_incidents; c be_contacts; inserted uuid;
begin
 select * into n from be_notifications where id=target for update;
 if not found or n.channel<>'n8n' or n.status<>'queued' or coalesce(trim(n.approved_by),'')='' then return null;end if;
 select * into i from be_incidents where id=n.incident_id for update;
 if i.status not in('verified','assigned') or i.node_id like 'DEMO%' or i.node_id like 'CHECK-%'
 or exists(select 1 from be_events where id=any(i.event_ids) and source='demo')
 or exists(select 1 from be_notifications where incident_id=i.id and channel<>'n8n') then return null;end if;
 select c1.* into c from be_contacts c1 join be_nodes node on node.sector=c1.sector where node.id=i.node_id and c1.id=n.contact_id and c1.enabled and c1.channel='whatsapp' and c1.destination=n.destination;
 if not found or c.destination !~ '^\+[1-9][0-9]{7,14}$' then return null;end if;
 insert into be_kapso_dispatches(notification_id) values(target) on conflict do nothing returning notification_id into inserted;
 if inserted is null then return null;end if;
 return jsonb_build_object('notification',to_jsonb(n),'incident',to_jsonb(i),'contact',to_jsonb(c));
end;$$;

create or replace function public.be_kapso_receipt(event_reference text, message_reference text, delivery_state text) returns boolean language plpgsql security definer set search_path=public as $$
declare target uuid; inserted text;
begin
 select notification_id into target from be_kapso_dispatches where provider_id=message_reference;
 if target is null then return false;end if;
 insert into be_kapso_receipts(event_id) values(event_reference) on conflict do nothing returning event_id into inserted;
 if inserted is null then return true;end if;
 perform be_notification_callback(target,delivery_state,message_reference,null);
 return true;
end;$$;

revoke all on function public.be_reserve_kapso(uuid), public.be_kapso_receipt(text,text,text) from public,anon,authenticated;
grant execute on function public.be_reserve_kapso(uuid), public.be_kapso_receipt(text,text,text) to service_role;
