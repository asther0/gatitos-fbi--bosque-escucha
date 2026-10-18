-- A local worker owns non-n8n notification channels. Never dispatch them from cloud.
create or replace function public.be_queue_notification(target uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare item be_incidents; notification be_notifications; contact be_contacts; fresh boolean:=false;
begin
 select * into item from be_incidents where id=target for update;
 if not found or item.status not in('verified','assigned') then raise exception 'La alerta requiere verificación humana';end if;
 select * into notification from be_notifications where incident_id=target order by case when channel<>'n8n' then 0 else 1 end,created_at limit 1;
 if found then return jsonb_build_object('notification',to_jsonb(notification),'created',false,'incident',to_jsonb(item));end if;
 select c.* into contact from be_contacts c join be_nodes n on n.sector=c.sector where n.id=item.node_id and c.enabled order by c.created_at limit 1;
 insert into be_notifications(incident_id,approved_by,contact_id,destination,status,last_error)
 values(target,'operator',contact.id,contact.destination,case when contact.id is null and item.node_id<>'DEMO-01' then 'blocked' else 'queued' end,case when contact.id is null and item.node_id<>'DEMO-01' then 'Falta configurar contacto autorizado para el sector' else null end)
 on conflict(incident_id,channel) do nothing returning * into notification;
 fresh:=found;
 if not fresh then select * into notification from be_notifications where incident_id=target and channel='n8n';
 else insert into be_audit(incident_id,action,actor,details) values(target,'notification_approved','operator',jsonb_build_object('notification_id',notification.id,'contact_id',contact.id));end if;
 return jsonb_build_object('notification',to_jsonb(notification),'created',fresh,'incident',to_jsonb(item));
end;$$;

create or replace function public.be_claim_notification(target uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare item be_notifications; incident be_incidents; contact be_contacts;
begin
 select * into item from be_notifications where id=target;
 if not found then return null;end if;
 select * into incident from be_incidents where id=item.incident_id for update;
 select * into item from be_notifications where id=target for update;
 if item.channel<>'n8n' or exists(select 1 from be_notifications where incident_id=item.incident_id and channel<>'n8n') then return null;end if;
 if incident.node_id='DEMO-01' or item.status in('sent','delivered') or item.attempts>=5 or item.next_attempt_at>now() then return null;end if;
 select c.* into contact from be_contacts c join be_nodes n on n.sector=c.sector where n.id=incident.node_id and c.enabled order by c.created_at limit 1;
 if contact.id is null then update be_notifications set status='blocked',last_error='Falta contacto autorizado' where id=target;return null;end if;
 update be_notifications set status='queued',contact_id=contact.id,destination=contact.destination,attempts=attempts+1,next_attempt_at=now()+interval '5 minutes',last_error=null where id=target returning * into item;
 return jsonb_build_object('notification',to_jsonb(item),'incident',to_jsonb(incident),'contact',to_jsonb(contact));
end;$$;
revoke all on function public.be_claim_notification(uuid) from public,anon,authenticated;
grant execute on function public.be_claim_notification(uuid) to service_role;
create or replace function public.be_sync_snapshot(payload jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare item jsonb;
begin
 -- Sync is atomic. Cloud human decisions and delivery records win over stale snapshots.
 for item in select value from jsonb_array_elements(payload->'nodes') loop
 insert into be_nodes select * from jsonb_populate_record(null::be_nodes,item)
 on conflict(id) do update set name=excluded.name,sector=excluded.sector,latitude=excluded.latitude,longitude=excluded.longitude,status=excluded.status,battery_pct=excluded.battery_pct,last_seen=excluded.last_seen where excluded.last_seen is not null and (be_nodes.last_seen is null or excluded.last_seen>=be_nodes.last_seen);
 end loop;
 for item in select value from jsonb_array_elements(payload->'events') loop
 insert into be_events select * from jsonb_populate_record(null::be_events,item) on conflict(id) do nothing;
 end loop;
 for item in select value from jsonb_array_elements(payload->'incidents') loop
 insert into be_incidents select * from jsonb_populate_record(null::be_incidents,item)
 on conflict(id) do update set title=excluded.title,priority=case when exists(select 1 from be_audit where incident_id=be_incidents.id and actor='operator' and action='priority_changed') then be_incidents.priority else excluded.priority end,status=excluded.status,summary=excluded.summary,event_ids=excluded.event_ids,assigned_to=excluded.assigned_to,review_note=excluded.review_note,updated_at=excluded.updated_at where excluded.updated_at>be_incidents.updated_at and not exists(select 1 from be_audit where incident_id=be_incidents.id and actor='operator' and action='human_review');
 end loop;
 for item in select value from jsonb_array_elements(payload->'audit') loop
 insert into be_audit select * from jsonb_populate_record(null::be_audit,item) on conflict(id) do nothing;
 end loop;
 for item in select value from jsonb_array_elements(payload->'notifications') loop
 perform 1 from be_incidents where id=(item->>'incident_id')::uuid for update;
 insert into be_notifications select * from jsonb_populate_record(null::be_notifications,jsonb_build_object('attempts',0,'next_attempt_at',now())||item) on conflict(incident_id,channel) do update set status=case when be_notifications.status='delivered' or excluded.status='delivered' then 'delivered' when be_notifications.status='sent' or excluded.status='sent' then 'sent' else be_notifications.status end,sent_at=coalesce(be_notifications.sent_at,excluded.sent_at),delivered_at=coalesce(be_notifications.delivered_at,excluded.delivered_at),acknowledged_at=coalesce(be_notifications.acknowledged_at,excluded.acknowledged_at),acknowledged_by=coalesce(be_notifications.acknowledged_by,excluded.acknowledged_by),provider_id=coalesce(be_notifications.provider_id,excluded.provider_id),attempts=greatest(be_notifications.attempts,excluded.attempts);
 end loop;
 return jsonb_build_object('received',jsonb_build_object('nodes',jsonb_array_length(payload->'nodes'),'events',jsonb_array_length(payload->'events'),'incidents',jsonb_array_length(payload->'incidents'),'audit',jsonb_array_length(payload->'audit'),'notifications',jsonb_array_length(payload->'notifications')));
end;$$;
revoke all on function public.be_sync_snapshot(jsonb) from public,anon,authenticated;
grant execute on function public.be_sync_snapshot(jsonb) to service_role;
