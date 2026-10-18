create table public.be_contacts (
 id uuid primary key default gen_random_uuid(), name text not null, sector text not null,
 destination text not null, channel text not null default 'whatsapp', enabled boolean not null default true,
 created_at timestamptz not null default now()
);
alter table public.be_contacts enable row level security;
alter table public.be_notifications add column contact_id uuid references public.be_contacts(id);
alter table public.be_notifications add column delivered_at timestamptz;
alter table public.be_notifications add column acknowledged_at timestamptz;
alter table public.be_notifications add column acknowledged_by text;
alter table public.be_notifications add column attempts integer not null default 0;
alter table public.be_notifications add column next_attempt_at timestamptz default now();
alter table public.be_notifications add column provider_id text;
alter table public.be_notifications add column destination text;
alter table public.be_notifications drop constraint be_notifications_status_check;
alter table public.be_notifications add constraint be_notifications_status_check check(status in('queued','sent','delivered','failed','blocked'));

create or replace function public.be_queue_notification(target uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare item be_incidents; notification be_notifications; contact be_contacts; fresh boolean:=false;
begin
 select * into item from be_incidents where id=target for update;
 if not found or item.status not in('verified','assigned') then raise exception 'La alerta requiere verificación humana';end if;
 select c.* into contact from be_contacts c join be_nodes n on n.sector=c.sector where n.id=item.node_id and c.enabled order by c.created_at limit 1;
 insert into be_notifications(incident_id,approved_by,contact_id,destination,status,last_error)
 values(target,'operator',contact.id,contact.destination,case when contact.id is null and item.node_id<>'DEMO-01' then 'blocked' else 'queued' end,case when contact.id is null and item.node_id<>'DEMO-01' then 'Falta configurar contacto autorizado para el sector' else null end)
 on conflict(incident_id,channel) do nothing returning * into notification;
 fresh:=found;
 if not fresh then select * into notification from be_notifications where incident_id=target and channel='n8n';
 else insert into be_audit(incident_id,action,actor,details) values(target,'notification_approved','operator',jsonb_build_object('notification_id',notification.id,'contact_id',contact.id));end if;
 return jsonb_build_object('notification',to_jsonb(notification),'created',fresh,'incident',to_jsonb(item));
end;$$;

create or replace function public.be_change_priority(target uuid,new_priority text,reason text) returns jsonb language plpgsql security definer set search_path=public as $$
declare item be_incidents;
begin
 if new_priority not in('high','medium','observation') or length(trim(reason))<3 then raise exception 'Prioridad y motivo requeridos';end if;
 select * into item from be_incidents where id=target for update;
 if not found then raise exception 'Incidente no encontrado';end if;
 insert into be_audit(incident_id,action,actor,details) values(target,'priority_changed','operator',jsonb_build_object('previous',item.priority,'priority',new_priority,'reason',reason));
 update be_incidents set priority=new_priority,review_note=reason,updated_at=now() where id=target returning * into item;
 return to_jsonb(item);
end;$$;
revoke all on function public.be_change_priority(uuid,text,text) from public,anon,authenticated;
grant execute on function public.be_change_priority(uuid,text,text) to service_role;

create or replace function public.be_claim_notification(target uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare item be_notifications; incident be_incidents; contact be_contacts;
begin
 select * into item from be_notifications where id=target for update;
 if not found then return null;end if;
 select * into incident from be_incidents where id=item.incident_id;
 if incident.node_id='DEMO-01' or item.status in('sent','delivered') or item.attempts>=5 or item.next_attempt_at>now() then return null;end if;
 select c.* into contact from be_contacts c join be_nodes n on n.sector=c.sector where n.id=incident.node_id and c.enabled order by c.created_at limit 1;
 if contact.id is null then update be_notifications set status='blocked',last_error='Falta contacto autorizado' where id=target;return null;end if;
 update be_notifications set status='queued',contact_id=contact.id,destination=contact.destination,attempts=attempts+1,next_attempt_at=now()+interval '5 minutes',last_error=null where id=target returning * into item;
 return jsonb_build_object('notification',to_jsonb(item),'incident',to_jsonb(incident),'contact',to_jsonb(contact));
end;$$;
revoke all on function public.be_claim_notification(uuid) from public,anon,authenticated;
grant execute on function public.be_claim_notification(uuid) to service_role;
create or replace function public.be_notification_callback(target uuid,delivery_status text,provider_reference text,human_actor text) returns jsonb language plpgsql security definer set search_path=public as $$
declare item be_notifications;
begin
 select * into item from be_notifications where id=target for update;
 if not found then raise exception 'Notificación desconocida';end if;
 if delivery_status='acknowledged' then
 if coalesce(length(trim(human_actor)),0)=0 then raise exception 'Identifica quién confirmó';end if;
 update be_notifications set acknowledged_at=coalesce(acknowledged_at,now()),acknowledged_by=human_actor where id=target returning * into item;
 elsif delivery_status in('sent','delivered','failed') then
 if item.status<>'delivered' and not(item.status='sent' and delivery_status='failed') then
 update be_notifications set status=delivery_status,provider_id=coalesce(provider_reference,provider_id),sent_at=case when delivery_status in('sent','delivered') then coalesce(sent_at,now()) else sent_at end,delivered_at=case when delivery_status='delivered' then coalesce(delivered_at,now()) else delivered_at end where id=target returning * into item;
 end if;
 else raise exception 'Estado inválido';end if;
 insert into be_audit(incident_id,action,actor,details) values(item.incident_id,'notification_'||delivery_status,coalesce(human_actor,'provider'),jsonb_build_object('notification_id',target,'provider_id',provider_reference));
 return to_jsonb(item);
end;$$;
revoke all on function public.be_notification_callback(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.be_notification_callback(uuid,text,text,text) to service_role;
