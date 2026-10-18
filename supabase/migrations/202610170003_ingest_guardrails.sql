create or replace function public.be_ingest_event(payload jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare ev be_events; inc be_incidents; ids uuid[]; saw boolean; person boolean; p text; t text; s text;
begin
 perform pg_advisory_xact_lock(hashtext(payload->>'node_id'));
 select * into ev from be_events where id=(payload->>'id')::uuid;
 if found then
 select * into inc from be_incidents where ev.id=any(event_ids) limit 1;
 return jsonb_build_object('event',to_jsonb(ev),'incident',case when inc.id is null then null else to_jsonb(inc) end,'idempotent',true);
 end if;
 insert into be_events select * from jsonb_populate_record(null::be_events,payload) returning * into ev;
 update be_nodes set status='online',last_seen=greatest(coalesce(last_seen,ev.received_at),ev.received_at) where id=ev.node_id;
 if ev.event_type='ambient' then return jsonb_build_object('event',to_jsonb(ev),'incident',null);end if;
 select array_agg(id),bool_or(event_type='chainsaw' and persistent),bool_or(event_type='person') into ids,saw,person from be_events where node_id=ev.node_id and (source='demo')=(ev.source='demo') and detected_at between ev.detected_at-interval '120 seconds' and ev.detected_at+interval '120 seconds' and event_type<>'ambient';
 p:=case when saw and person then 'high' when saw then 'medium' else 'observation' end;
 t:=case when p='high' then 'Motosierra persistente y presencia humana' when p='medium' then 'Sonido persistente de motosierra' else 'Actividad por revisar' end;
 s:='Señales registradas en una ventana de 120 segundos. Revisar evidencia; no confirma actividad ilegal.';
 select * into inc from be_incidents where node_id=ev.node_id and status='pending_review' and event_ids && ids order by created_at desc limit 1 for update;
 if inc.id is null then insert into be_incidents(node_id,title,priority,summary,event_ids) values(ev.node_id,t,p,s,ids) returning * into inc;
 else update be_incidents set title=case when exists(select 1 from be_audit where incident_id=inc.id and action='priority_changed') then be_incidents.title else t end,priority=case when exists(select 1 from be_audit where incident_id=inc.id and action='priority_changed') then be_incidents.priority else p end,summary=s,event_ids=(select array_agg(distinct x) from unnest(event_ids||ids) x),updated_at=now() where id=inc.id returning * into inc;end if;
 insert into be_audit(incident_id,action,actor,details) values(inc.id,'signal_received',ev.source,jsonb_build_object('event_id',ev.id));
 return jsonb_build_object('event',to_jsonb(ev),'incident',to_jsonb(inc));
end;$$;
revoke all on function public.be_ingest_event(jsonb) from public,anon,authenticated;
grant execute on function public.be_ingest_event(jsonb) to service_role;


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
 on conflict(id) do update set title=excluded.title,priority=case when exists(select 1 from be_audit where incident_id=be_incidents.id and action='priority_changed') then be_incidents.priority else excluded.priority end,status=excluded.status,summary=excluded.summary,event_ids=excluded.event_ids,assigned_to=excluded.assigned_to,review_note=excluded.review_note,updated_at=excluded.updated_at where be_incidents.status='pending_review' and excluded.updated_at>be_incidents.updated_at;
 end loop;
 for item in select value from jsonb_array_elements(payload->'audit') loop
 insert into be_audit select * from jsonb_populate_record(null::be_audit,item) on conflict(id) do nothing;
 end loop;
 for item in select value from jsonb_array_elements(payload->'notifications') loop
 insert into be_notifications select * from jsonb_populate_record(null::be_notifications,jsonb_build_object('attempts',0,'next_attempt_at',now())||item) on conflict do nothing;
 end loop;
 return jsonb_build_object('received',jsonb_build_object('nodes',jsonb_array_length(payload->'nodes'),'events',jsonb_array_length(payload->'events'),'incidents',jsonb_array_length(payload->'incidents'),'audit',jsonb_array_length(payload->'audit'),'notifications',jsonb_array_length(payload->'notifications')));
end;$$;
revoke all on function public.be_sync_snapshot(jsonb) from public,anon,authenticated;
grant execute on function public.be_sync_snapshot(jsonb) to service_role;
