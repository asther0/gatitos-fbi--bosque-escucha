"""A configured webhook must never receive demo incidents, including legacy jobs."""
import json,os,tempfile,time
import httpx
from fastapi.testclient import TestClient
with tempfile.TemporaryDirectory() as folder:
    os.environ.update(LOCAL_DATA_DIR=folder,LOCAL_CENTER_TOKEN='guard-smoke',N8N_NOTIFY_WEBHOOK='https://fake.invalid/notify',N8N_WEBHOOK_TOKEN='fake')
    os.environ.pop('CLOUD_BASE_URL',None)
    import app
    calls=[]
    def webhook(request):calls.append(request);return httpx.Response(200,json={'ok':True})
    original=httpx.AsyncClient
    app.httpx.AsyncClient=lambda *a,**kw:original(*a,**kw,transport=httpx.MockTransport(webhook))
    with TestClient(app.app,headers={'Authorization':'Bearer guard-smoke'}) as c:
        for node in ('DEMO-01','REAL-NAME'):
            result=c.post('/api/events',json={'node_id':node,'event_type':'chainsaw','confidence':.9,'persistent':True,'source':'demo'})
            incident=result.json()['incident'];iid=incident['id']
            assert c.patch(f'/api/incidents/{iid}',json={'status':'verified'}).status_code==200
            assigned=c.patch(f'/api/incidents/{iid}',json={'status':'assigned','assigned_to':'test-only'}).json()
            response=c.post(f'/api/incidents/{iid}/notify',json={'approved':True})
            assert response.status_code==200 and response.json()['status']=='blocked'
            n=response.json()
            with app.connect() as db:
                assert db.execute("SELECT COUNT(*) FROM jobs WHERE kind='notify'").fetchone()[0]==0
                # Simulate a pre-fix queued job; worker must block it without HTTP.
                db.execute('INSERT INTO jobs(id,kind,body) VALUES(?,?,?)',(n['id'],'notify',json.dumps({'notification':n,'incident':assigned,'recipient':'test-only'})))
            time.sleep(5.2)
            with app.connect() as db:assert db.execute("SELECT COUNT(*) FROM jobs WHERE kind='notify'").fetchone()[0]==0
        assert not calls,f'Unexpected external demo requests: {len(calls)}'
        assert c.put('/api/nodes/invalid%20node',json={}).status_code==422
    app.httpx.AsyncClient=original
print('PASS: configured webhook received zero demo calls; new and legacy jobs blocked; node ID validated')
