-- An operator may explicitly send one clearly marked test message for a
-- physical ESP32 microphone capture. Synthetic demo events remain blocked.
create or replace function public.be_queue_notification(target uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare i be_incidents; n be_notifications; c be_contacts; fresh boolean:=false;
begin
 select * into i from be_incidents where id=target for update;
 if not found or i.status not in('verified','assigned') then raise exception 'La alerta requiere verificación humana';end if;
 if i.node_id like 'DEMO%' or i.node_id like 'CHECK-%'
 or exists(select 1 from be_events where id=any(i.event_ids) and source='demo')
 then raise exception 'Los nodos de prueba usan únicamente el envío explícito de simulacro';end if;
 select * into n from be_notifications where incident_id=target order by case when channel<>'n8n' then 0 else 1 end,created_at limit 1;
 if found then return jsonb_build_object('notification',to_jsonb(n),'created',false,'incident',to_jsonb(i));end if;
 select c1.* into c from be_contacts c1 join be_nodes node on node.sector=c1.sector
 where node.id=i.node_id and c1.enabled order by c1.created_at limit 1;
 insert into be_notifications(incident_id,approved_by,contact_id,destination,status,last_error)
 values(target,'operator',c.id,c.destination,case when c.id is null then 'blocked' else 'queued' end,
 case when c.id is null then 'Falta configurar contacto autorizado para el sector' else null end)
 on conflict(incident_id,channel) do nothing returning * into n;
 fresh:=found;
 if not fresh then select * into n from be_notifications where incident_id=target and channel='n8n';
 else insert into be_audit(incident_id,action,actor,details)
 values(target,'notification_approved','operator',jsonb_build_object('notification_id',n.id,'contact_id',c.id));end if;
 return jsonb_build_object('notification',to_jsonb(n),'created',fresh,'incident',to_jsonb(i));
end;$$;

create or replace function public.be_queue_demo_notification(target uuid, demo_destination text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare i be_incidents; n be_notifications; c be_contacts; fresh boolean;
begin
 if demo_destination !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'Destinatario de prueba no configurado';end if;
 select * into i from be_incidents where id=target for update;
 if not found or i.node_id<>'DEMO-ESP32-WIFI' or i.status not in('verified','assigned')
 or not exists(select 1 from be_events where id=any(i.event_ids) and source='local_center' and node_id=i.node_id and evidence_type='audio')
 or exists(select 1 from be_events where id=any(i.event_ids) and source='demo')
 then raise exception 'El simulacro requiere una captura física revisada';end if;
 if exists(select 1 from be_notifications where incident_id=target and channel<>'n8n')
 then raise exception 'El caso ya tiene otro canal de notificación';end if;
 select * into c from be_contacts where destination=demo_destination and channel='whatsapp' and not enabled order by created_at limit 1;
 if not found then
  insert into be_contacts(name,sector,destination,channel,enabled)
  values('Destinatario de simulacro','SIMULACRO',demo_destination,'whatsapp',false) returning * into c;
 end if;
 insert into be_notifications(incident_id,channel,approved_by,contact_id,destination,status)
 values(target,'n8n','operator_demo',c.id,demo_destination,'queued')
 on conflict(incident_id,channel) do nothing returning * into n;
 fresh:=found;
 if not fresh then
  select * into n from be_notifications where incident_id=target and channel='n8n' for update;
  if n.approved_by<>'operator_demo' or n.destination<>demo_destination then
   raise exception 'El caso ya tiene una notificación distinta';
  end if;
 else
  insert into be_audit(incident_id,action,actor,details)
  values(target,'demo_notification_approved','operator',jsonb_build_object('notification_id',n.id));
 end if;
 return jsonb_build_object('notification',to_jsonb(n),'created',fresh,'incident',to_jsonb(i));
end;$$;

create or replace function public.be_claim_notification(target uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare n be_notifications; i be_incidents; c be_contacts;
begin
 select * into n from be_notifications where id=target;
 if not found then return null;end if;
 select * into i from be_incidents where id=n.incident_id for update;
 select * into n from be_notifications where id=target for update;
 if n.channel<>'n8n' or exists(select 1 from be_notifications where incident_id=n.incident_id and channel<>'n8n')
 or n.status in('sent','delivered') or n.attempts>=5 or n.next_attempt_at>now()
 or exists(select 1 from be_kapso_dispatches where notification_id=n.id) then return null;end if;
 if n.approved_by='operator_demo' then
  if i.status not in('verified','assigned') or i.node_id<>'DEMO-ESP32-WIFI'
  or not exists(select 1 from be_events where id=any(i.event_ids) and source='local_center' and node_id=i.node_id and evidence_type='audio')
  or exists(select 1 from be_events where id=any(i.event_ids) and source='demo') then return null;end if;
  select * into c from be_contacts where id=n.contact_id and not enabled and channel='whatsapp' and destination=n.destination;
 else
  if i.node_id like 'DEMO%' or i.node_id like 'CHECK-%' then return null;end if;
  select c1.* into c from be_contacts c1 join be_nodes node on node.sector=c1.sector
   where node.id=i.node_id and c1.enabled and c1.channel='whatsapp' order by c1.created_at limit 1;
 end if;
 if c.id is null then
  update be_notifications set status='blocked',last_error='Falta contacto autorizado' where id=target;
  return null;
 end if;
 update be_notifications set status='queued',contact_id=c.id,destination=c.destination,
  attempts=attempts+1,next_attempt_at=now()+interval '5 minutes',last_error=null
  where id=target returning * into n;
 return jsonb_build_object('notification',to_jsonb(n),'incident',to_jsonb(i),'contact',to_jsonb(c));
end;$$;

create or replace function public.be_reserve_kapso_send(target uuid, expected_demo_destination text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare n be_notifications; i be_incidents; c be_contacts; inserted uuid;
begin
 select * into n from be_notifications where id=target for update;
 if not found or n.channel<>'n8n' or n.status<>'queued' or coalesce(trim(n.approved_by),'')='' then return null;end if;
 select * into i from be_incidents where id=n.incident_id for update;
 if i.status not in('verified','assigned') or i.node_id like 'CHECK-%'
 or exists(select 1 from be_events where id=any(i.event_ids) and source='demo')
 or exists(select 1 from be_notifications where incident_id=i.id and channel<>'n8n') then return null;end if;
 if n.approved_by='operator_demo' then
  if i.node_id<>'DEMO-ESP32-WIFI' or expected_demo_destination is null
  or expected_demo_destination !~ '^\+[1-9][0-9]{7,14}$' or n.destination<>expected_demo_destination
  or not exists(select 1 from be_events where id=any(i.event_ids) and source='local_center' and node_id=i.node_id and evidence_type='audio')
  then return null;end if;
  select * into c from be_contacts where id=n.contact_id and not enabled and channel='whatsapp' and destination=n.destination;
 else
  if i.node_id like 'DEMO%' then return null;end if;
  select c1.* into c from be_contacts c1 join be_nodes node on node.sector=c1.sector
   where node.id=i.node_id and c1.id=n.contact_id and c1.enabled and c1.channel='whatsapp' and c1.destination=n.destination;
 end if;
 if c.id is null or c.destination !~ '^\+[1-9][0-9]{7,14}$' then return null;end if;
 insert into be_kapso_dispatches(notification_id) values(target) on conflict do nothing returning notification_id into inserted;
 if inserted is null then return null;end if;
 return jsonb_build_object('notification',to_jsonb(n),'incident',to_jsonb(i),'contact',to_jsonb(c));
end;$$;

revoke all on function public.be_queue_notification(uuid),public.be_queue_demo_notification(uuid,text),public.be_claim_notification(uuid),public.be_reserve_kapso_send(uuid,text) from public,anon,authenticated;
grant execute on function public.be_queue_notification(uuid),public.be_queue_demo_notification(uuid,text),public.be_claim_notification(uuid),public.be_reserve_kapso_send(uuid,text) to service_role;
notify pgrst, 'reload schema';
