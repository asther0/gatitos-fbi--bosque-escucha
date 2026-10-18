"""Offline/reconnect integration smoke against an in-process fake HTTP cloud."""
import asyncio,io,json,os,tempfile,uuid,wave
import httpx
async def check():
    with tempfile.TemporaryDirectory() as folder:
        os.environ.update(LOCAL_DATA_DIR=folder,LOCAL_CENTER_TOKEN='smoke',CLOUD_BASE_URL='https://fake-cloud.invalid',CENTER_SYNC_TOKEN='sync-smoke')
        os.environ.pop('N8N_NOTIFY_WEBHOOK',None)
        import app
        output=io.BytesIO()
        with wave.open(output,'wb') as wav:wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(16000);wav.writeframes(b'\x00'*32000)
        path='fixture.wav';(app.DATA/'evidence'/path).write_bytes(output.getvalue())
        event_id=str(uuid.uuid4())
        app.ingest(app.EventIn(event_id=event_id,node_id='A01',event_type='chainsaw',confidence=.8,persistent=True,evidence_path=path,evidence_type='audio'))
        mic_event_id=str(uuid.uuid4())
        app.ingest(app.EventIn(event_id=mic_event_id,node_id='DEMO-ESP32-WIFI',event_type='chainsaw',confidence=.84,source='device'))
        app.ingest(app.EventIn(node_id='DEMO-01',event_type='person',confidence=.9,source='demo'))
        seen={'uploads':0,'syncs':0,'ids':set(),'snapshot':None,'nodes':set()}
        def cloud(request):
            assert request.headers['Authorization']=='Bearer sync-smoke'
            if request.url.path=='/api/evidence':
                assert 'A01' in seen['nodes'],'Upload attempted before cloud node registration'
                seen['uploads']+=1
                return httpx.Response(200,json={'path':'A01/private.wav','type':'audio'})
            assert request.url.path=='/api/sync'
            payload=json.loads(request.content)
            seen['nodes'].update(n['id'] for n in payload['nodes'])
            if not payload['events']:return httpx.Response(200,json={'ok':True})
            seen['syncs']+=1
            if seen['syncs']==1:raise httpx.ConnectError('Offline simulation',request=request)
            payload=json.loads(request.content);seen['snapshot']=payload
            for event in payload['events']:seen['ids'].add(event['id'])
            return httpx.Response(200,json={'ok':True})
        original=httpx.AsyncClient
        app.httpx.AsyncClient=lambda *a,**kw:original(*a,**kw,transport=httpx.MockTransport(cloud))
        task=asyncio.create_task(app.process_jobs())
        try:
            await asyncio.sleep(.1)
            with app.connect() as c:
                job=dict(c.execute("SELECT * FROM jobs WHERE id='cloud-sync'").fetchone())
                assert job['attempts']==1
                c.execute('UPDATE jobs SET next_at=0')
            await asyncio.sleep(5.2)
            assert seen['uploads']==1 and seen['syncs']==2,seen
            assert seen['ids']=={event_id,mic_event_id}
            assert next(e for e in seen['snapshot']['events'] if e['id']==event_id)['evidence_path']=='A01/private.wav'
            assert any(e['id']==mic_event_id for e in seen['snapshot']['events'])
            assert 'DEMO-ESP32-WIFI' in seen['nodes'] and 'DEMO-01' not in seen['nodes']
            assert all(e['detected_at'].endswith('Z') for e in seen['snapshot']['events'])
            with app.connect() as c:
                assert not c.execute('SELECT * FROM jobs').fetchall()
                assert app.get(c,'events',event_id)['evidence_path']==path
                app.sync_job(c)
            await asyncio.sleep(5.2)
            assert seen['uploads']==1 and seen['syncs']==3,seen
            assert len(seen['ids'])==2
            # A long offline period must not strand an already exhausted sync job.
            with app.connect() as c:
                app.sync_job(c)
                c.execute("UPDATE jobs SET attempts=8,next_at=0 WHERE id='cloud-sync'")
            await asyncio.sleep(5.2)
            assert seen['uploads']==1 and seen['syncs']==4,seen
            with app.connect() as c:
                assert not c.execute("SELECT * FROM jobs WHERE id='cloud-sync'").fetchall()
            print('PASS: offline retry including >8 attempts, one blob upload, private cloud path, local path preserved, UUID upsert, physical DEMO mic included, synthetic DEMO excluded')
        finally:
            task.cancel();app.httpx.AsyncClient=original
            try:await task
            except asyncio.CancelledError:pass
asyncio.run(check())
