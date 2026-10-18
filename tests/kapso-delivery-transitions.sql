-- Synthetic fixture only; no contact, destination or provider dispatch.
-- Run after migration 202610180007. Every write is rolled back.
begin;
set local statement_timeout = '15s';
set local lock_timeout = '3s';
create temporary table kapso_transition_test_results (test text, passed boolean) on commit drop;
do $$
declare
  fixture_node text := 'CHECK-KAPSO-TRANSITIONS-' || gen_random_uuid()::text;
  fixture_incident uuid := gen_random_uuid();
  fixture_notification uuid := gen_random_uuid();
  fixture_provider text := 'synthetic-test-' || gen_random_uuid()::text;
  receipt jsonb;
  saved_sent_at timestamptz;
  saved_delivered_at timestamptz;
begin
  insert into public.be_nodes(id,name,sector) values(fixture_node,'SYNTHETIC SQL rollback test','TEST ONLY');
  insert into public.be_incidents(id,node_id,title,priority,status,summary)
    values(fixture_incident,fixture_node,'SYNTHETIC delivery transitions','observation','pending_review','SQL rollback fixture; no real incident or dispatch');
  insert into public.be_notifications(id,incident_id,channel,status,approved_by)
    values(fixture_notification,fixture_incident,'n8n','queued','synthetic-sql-test');

  receipt := public.be_notification_callback(fixture_notification,'sent',fixture_provider,null);
  if receipt->>'status' is distinct from 'sent' or receipt->>'sent_at' is null then
    raise exception 'FAIL queued to sent: %',receipt;
  end if;
  saved_sent_at := (receipt->>'sent_at')::timestamptz;
  insert into kapso_transition_test_results values('queued -> sent',true);

  receipt := public.be_notification_callback(fixture_notification,'failed',fixture_provider,null);
  if receipt->>'status' is distinct from 'failed' or (receipt->>'sent_at')::timestamptz is distinct from saved_sent_at then
    raise exception 'FAIL sent to failed: %',receipt;
  end if;
  insert into kapso_transition_test_results values('sent -> failed, preserves sent_at',true);

  receipt := public.be_notification_callback(fixture_notification,'sent',fixture_provider,null);
  if receipt->>'status' is distinct from 'failed' then raise exception 'FAIL late sent overwrote failed: %',receipt; end if;
  insert into kapso_transition_test_results values('failed -> sent blocked',true);

  receipt := public.be_notification_callback(fixture_notification,'delivered',fixture_provider,null);
  if receipt->>'status' is distinct from 'delivered' or receipt->>'delivered_at' is null then
    raise exception 'FAIL failed to delivered: %',receipt;
  end if;
  saved_delivered_at := (receipt->>'delivered_at')::timestamptz;
  insert into kapso_transition_test_results values('failed -> delivered',true);

  perform public.be_notification_callback(fixture_notification,'failed',fixture_provider,null);
  receipt := public.be_notification_callback(fixture_notification,'sent',fixture_provider,null);
  if receipt->>'status' is distinct from 'delivered'
    or (receipt->>'delivered_at')::timestamptz is distinct from saved_delivered_at
    or (receipt->>'sent_at')::timestamptz is distinct from saved_sent_at then
    raise exception 'FAIL delivered is not terminal: %',receipt;
  end if;
  insert into kapso_transition_test_results values('delivered terminal against failed and sent',true);
end;
$$;
select * from kapso_transition_test_results;
rollback;
