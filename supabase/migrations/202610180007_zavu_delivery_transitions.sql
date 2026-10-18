create or replace function public.be_notification_callback(target uuid,delivery_status text,provider_reference text,human_actor text) returns jsonb language plpgsql security definer set search_path=public as $$
declare item be_notifications;
begin
 select * into item from be_notifications where id=target for update;
 if not found then raise exception 'Notificación desconocida';end if;
 if delivery_status='acknowledged' then
 if coalesce(length(trim(human_actor)),0)=0 then raise exception 'Identifica quién confirmó';end if;
 update be_notifications set acknowledged_at=coalesce(acknowledged_at,now()),acknowledged_by=human_actor where id=target returning * into item;
 elsif delivery_status in('sent','delivered','failed') then
 -- Delivery failure can follow provider acceptance; late sent must not erase failure.
 if item.status<>'delivered' and not(item.status='failed' and delivery_status='sent') then
 update be_notifications set status=delivery_status,provider_id=coalesce(provider_reference,provider_id),sent_at=case when delivery_status in('sent','delivered') then coalesce(sent_at,now()) else sent_at end,delivered_at=case when delivery_status='delivered' then coalesce(delivered_at,now()) else delivered_at end where id=target returning * into item;
 end if;
 else raise exception 'Estado inválido';end if;
 insert into be_audit(incident_id,action,actor,details) values(item.incident_id,'notification_'||delivery_status,coalesce(human_actor,'provider'),jsonb_build_object('notification_id',target,'provider_id',provider_reference));
 return to_jsonb(item);
end;$$;
revoke all on function public.be_notification_callback(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.be_notification_callback(uuid,text,text,text) to service_role;
