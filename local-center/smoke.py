"""Small API smoke test, isolated temporary data; no hardware/network/models."""
import os,tempfile,uuid,io,wave
with tempfile.TemporaryDirectory() as folder:
    os.environ['LOCAL_DATA_DIR']=folder;os.environ['LOCAL_CENTER_TOKEN']='smoke-only';os.environ['NOTIFICATION_CALLBACK_SECRET']='callback-only'
    os.environ.pop('CLOUD_BASE_URL',None);os.environ.pop('N8N_NOTIFY_WEBHOOK',None)
    from fastapi.testclient import TestClient
    from app import app
    with TestClient(app) as c:
        assert c.get('/api/dashboard').status_code==401
        c.headers['Authorization']='Bearer smoke-only'
        audio=io.BytesIO()
        with wave.open(audio,'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(16000);f.writeframes(b'\0'*32000)
        capture_id=str(uuid.uuid4())
        raw=c.post('/api/raw',files={'file':('clip.wav',audio.getvalue())},data={'node_id':'RAW-01','capture_id':capture_id})
        assert raw.status_code==200,raw.text
        assert raw.json()['analysis_status']=='blocked' and 'deshabilitado' in raw.json()['analysis_error']
        assert c.get('/api/evidence',params={'path':raw.json()['path']}).status_code==200
        duplicate=c.post('/api/raw',files={'file':('clip.wav',audio.getvalue())},data={'node_id':'RAW-01','capture_id':capture_id})
        assert duplicate.json()==raw.json()
        assert len(c.get('/api/dashboard').json()['events'])==0,'Raw input must not fabricate detections'
        event={'event_id':str(uuid.uuid4()),'node_id':'TEST-01','event_type':'chainsaw','confidence':.8,'persistent':True,'source':'demo'}
        r=c.post('/api/events',json=event);assert r.status_code==200,r.text
        incident=r.json()['incident'];assert incident['priority']=='medium'
        assert c.post('/api/events',json=event).json()['event']['id']==event['event_id']
        assert len(c.get('/api/dashboard').json()['events'])==1
        r=c.post('/api/events',json={**event,'event_id':str(uuid.uuid4()),'event_type':'person','persistent':False})
        assert r.json()['incident']['priority']=='high'
        iid=incident['id']
        assert c.post(f'/api/incidents/{iid}/notify',json={'approved':True}).status_code==409
        assert c.patch(f'/api/incidents/{iid}',json={'status':'closed'}).status_code==409
        assert c.patch(f'/api/incidents/{iid}',json={'status':'verified','review_note':'Inspección necesaria'}).status_code==200
        assert c.patch(f'/api/incidents/{iid}',json={'status':'assigned','assigned_to':'test-contact'}).status_code==200
        n=c.post(f'/api/incidents/{iid}/notify',json={'approved':True});assert n.status_code==200,n.text
        assert c.post(f'/api/incidents/{iid}/notify',json={'approved':True}).json()['id']==n.json()['id']
        data=c.get('/api/dashboard').json();assert len(data['notifications'])==1
        callback={'notification_id':n.json()['id'],'status':'delivered'}
        assert c.post('/api/notifications/callback',json=callback).status_code==401
        callback_headers={'Authorization':'Bearer callback-only'}
        delivered=c.post('/api/notifications/callback',json=callback,headers=callback_headers)
        assert delivered.status_code==200,delivered.text
        assert delivered.json()['notification']['status']=='delivered'
        assert c.post('/api/notifications/callback',json=callback,headers=callback_headers).json()==delivered.json()
        assert c.post('/api/notifications/callback',json={**callback,'status':'acknowledged'},headers=callback_headers).status_code==422
        acknowledged=c.post('/api/notifications/callback',json={**callback,'status':'acknowledged','actor':'contacto'},headers=callback_headers)
        assert acknowledged.json()['notification']['acknowledged_by']=='contacto'
        assert c.get('/api/evidence?path=../app.py').status_code==400
        assert c.post('/api/evidence',files={'file':('bad.jpg',b'invalid')},data={'node_id':'TEST-01'}).status_code==415
        assert c.post('/api/events',json={**event,'event_id':str(uuid.uuid4()),'event_type':'ambient'}).json()['incident'] is None
    print('PASS: auth, dedupe, triage, review, notification queue, invalid transitions and evidence validation')
