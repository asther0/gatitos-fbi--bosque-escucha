"""Heartbeat does not create evidence/events; future capture times fail before writes."""
import io,os,tempfile,wave
from datetime import datetime,timedelta,timezone
from fastapi.testclient import TestClient
with tempfile.TemporaryDirectory() as folder:
    os.environ.update(LOCAL_DATA_DIR=folder,LOCAL_CENTER_TOKEN='heartbeat-smoke')
    os.environ.pop('CLOUD_BASE_URL',None);os.environ.pop('N8N_NOTIFY_WEBHOOK',None)
    import app
    with TestClient(app.app,headers={'Authorization':'Bearer heartbeat-smoke'}) as c:
        assert c.post('/api/nodes/A01/heartbeat',json={'battery_pct':87}).status_code==200
        d=c.get('/api/dashboard').json();assert not d['events'] and not d['incidents']
        assert d['nodes'][0]['status']=='online' and d['nodes'][0]['battery_pct']==87
        c.put('/api/nodes/A01',json={'name':'Árbol','sector':'A','latitude':-12,'longitude':-69})
        result=c.post('/api/nodes/A01/heartbeat',json={}).json()['node']
        assert result['name']=='Árbol' and result['latitude']==-12 and result['battery_pct']==87
        assert c.post('/api/nodes/A01/heartbeat',json={'battery_pct':101}).status_code==422
        future=(datetime.now(timezone.utc)+timedelta(minutes=2)).isoformat()
        assert c.post('/api/events',json={'node_id':'A01','event_type':'person','confidence':.9,'detected_at':future}).status_code==422
        audio=io.BytesIO()
        with wave.open(audio,'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(16000);f.writeframes(b'\0'*32000)
        assert c.post('/api/raw',files={'file':('clip.wav',audio.getvalue())},data={'node_id':'A01','detected_at':future}).status_code==422
        assert not list((app.DATA/'evidence').iterdir())
        d=c.get('/api/dashboard').json();assert not d['events'] and not d['incidents'] and not d['captures']
print('PASS: heartbeat updates node only, preserves configuration, future timestamps rejected before persistence')
