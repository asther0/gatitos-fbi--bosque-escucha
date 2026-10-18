create table if not exists public.be_nodes(id text primary key,name text not null,sector text not null default '',latitude double precision,longitude double precision,status text not null default 'offline' check(status in('online','offline','maintenance')),battery_pct double precision check(battery_pct between 0 and 100),last_seen timestamptz,created_at timestamptz not null default now());
create table if not exists public.be_events(id uuid primary key default gen_random_uuid(),node_id text not null references public.be_nodes(id),event_type text not null check(event_type in('chainsaw','person','footsteps','ambient')),confidence double precision not null check(confidence between 0 and 1),detected_at timestamptz not null,received_at timestamptz not null default now(),source text not null check(source in('device','manual','demo','local_center')),persistent boolean not null default false,evidence_path text,evidence_type text check(evidence_type in('image','audio')),metadata jsonb not null default '{}',check((node_id='DEMO-01')=(source='demo')));
create index if not exists be_events_node_time on public.be_events(node_id,detected_at desc);
create table if not exists public.be_incidents(id uuid primary key default gen_random_uuid(),node_id text not null references public.be_nodes(id),title text not null,priority text not null check(priority in('high','medium','observation')),status text not null default 'pending_review' check(status in('pending_review','discarded','verified','assigned','closed')),summary text not null,event_ids uuid[] not null default '{}',assigned_to text,review_note text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table if not exists public.be_audit(id uuid primary key default gen_random_uuid(),incident_id uuid not null references public.be_incidents(id),action text not null,actor text not null,details jsonb not null default '{}',created_at timestamptz not null default now());
create table if not exists public.be_notifications(id uuid primary key default gen_random_uuid(),incident_id uuid not null references public.be_incidents(id),channel text not null default 'n8n',status text not null default 'queued' check(status in('queued','sent','failed')),approved_by text not null,created_at timestamptz not null default now(),sent_at timestamptz,last_error text,unique(incident_id,channel));
alter table public.be_nodes enable row level security;
alter table public.be_events enable row level security;
alter table public.be_incidents enable row level security;
alter table public.be_audit enable row level security;
alter table public.be_notifications enable row level security;
insert into public.be_nodes(id,name,sector) values('BOSQUE-01','Nodo de campo 01','Por configurar'),('DEMO-01','Nodo de demostración','Entorno demo') on conflict(id) do nothing;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('be-evidence','be-evidence',false,4194304,array['image/jpeg','image/png','audio/wav','audio/x-wav']) on conflict(id) do nothing;

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

create or replace function public.be_review_incident(target uuid,next_status text,note text,assignee text) returns jsonb language plpgsql security definer set search_path=public as $$
declare item be_incidents;
begin
 select * into item from be_incidents where id=target for update;
 if not found then raise exception 'Incidente no encontrado';end if;
 if not ((item.status='pending_review' and next_status in('discarded','verified')) or (item.status='verified' and next_status in('assigned','closed')) or(item.status='assigned' and next_status='closed')) then raise exception 'Transición no permitida';end if;
 if next_status='assigned' and coalesce(trim(assignee),'')='' then raise exception 'Indica responsable';end if;
 update be_incidents set status=next_status,review_note=coalesce(note,review_note),assigned_to=coalesce(assignee,assigned_to),updated_at=now() where id=target returning * into item;
 insert into be_audit(incident_id,action,actor,details) values(target,'human_review','operator',jsonb_build_object('status',next_status,'note',note,'assigned_to',assignee));
 return to_jsonb(item);
end;$$;
revoke all on function public.be_review_incident(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.be_review_incident(uuid,text,text,text) to service_role;
create or replace function public.be_queue_notification(target uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare item be_incidents; notification be_notifications; fresh boolean:=false;
begin
 select * into item from be_incidents where id=target for update;
 if not found or item.status not in('verified','assigned') then raise exception 'La alerta requiere verificación humana';end if;
 if item.node_id='DEMO-01' then raise exception 'Las demostraciones no envían notificaciones externas';end if;
 insert into be_notifications(incident_id,approved_by) values(target,'operator') on conflict(incident_id,channel) do nothing returning * into notification;
 fresh:=found;
 if not fresh then select * into notification from be_notifications where incident_id=target and channel='n8n';
 else insert into be_audit(incident_id,action,actor,details) values(target,'notification_approved','operator',jsonb_build_object('notification_id',notification.id));end if;
 return jsonb_build_object('notification',to_jsonb(notification),'created',fresh,'incident',to_jsonb(item));
end;$$;
revoke all on function public.be_queue_notification(uuid) from public,anon,authenticated;
grant execute on function public.be_queue_notification(uuid) to service_role;

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
 on conflict(id) do update set title=excluded.title,priority=excluded.priority,status=excluded.status,summary=excluded.summary,event_ids=excluded.event_ids,assigned_to=excluded.assigned_to,review_note=excluded.review_note,updated_at=excluded.updated_at where be_incidents.status='pending_review' and excluded.updated_at>be_incidents.updated_at;
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
