"""Offline command center. Run only on loopback; all API access requires a token."""
import asyncio, hashlib, json, logging, os, secrets, sqlite3, time, uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
import httpx
from fastapi import FastAPI, Depends, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

ROOT = Path(__file__).parent
DATA = Path(os.getenv('LOCAL_DATA_DIR', str(ROOT / 'data')))
DATA.mkdir(parents=True, exist_ok=True)
(DATA / 'evidence').mkdir(exist_ok=True)
TOKEN = os.getenv('LOCAL_CENTER_TOKEN')
if not TOKEN:
    token_file = DATA / '.token'
    if not token_file.exists():
        token_file.write_text(secrets.token_urlsafe(32)); token_file.chmod(0o600)
    TOKEN = token_file.read_text().strip()
DB = DATA / 'center.sqlite3'
def now(): return datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
def uid(): return str(uuid.uuid4())
def connect():
    c = sqlite3.connect(DB); c.row_factory = sqlite3.Row
    c.execute('PRAGMA journal_mode=WAL')
    return c
with connect() as c:
    for table in ('nodes','events','incidents','audit','notifications'):
        c.execute(f'CREATE TABLE IF NOT EXISTS {table} (id TEXT PRIMARY KEY, body TEXT NOT NULL)')
    c.execute('CREATE TABLE IF NOT EXISTS cloud_evidence (id TEXT PRIMARY KEY, remote_path TEXT NOT NULL)')
    c.execute('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, kind TEXT, body TEXT, attempts INTEGER DEFAULT 0, next_at REAL DEFAULT 0, error TEXT)')
def rows(c,t): return [json.loads(r['body']) for r in c.execute(f'SELECT body FROM {t}')]
def put(c,t,v): c.execute(f'INSERT INTO {t}(id,body) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',(v['id'],json.dumps(v)))
def get(c,t,k):
    r=c.execute(f'SELECT body FROM {t} WHERE id=?',(k,)).fetchone()
    if not r: raise HTTPException(404,'Registro no encontrado')
    return json.loads(r['body'])
def audit(c,i,action,details): put(c,'audit',dict(id=uid(),incident_id=i,action=action,actor='local_operator',details=details,created_at=now()))
def sync_job(c):
    # Replacing queued snapshot does not change the idempotency keys of its records.
    c.execute("INSERT INTO jobs(id,kind,body) VALUES('cloud-sync','sync',?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,next_at=0,attempts=0", (uid(),))
def auth(request:Request):
    value=request.headers.get('authorization','').removeprefix('Bearer ')
    if not secrets.compare_digest(value,TOKEN): raise HTTPException(401,'Token local requerido')
def stamp(s):
    try:return datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()
    except (ValueError,TypeError):raise HTTPException(422,'Timestamp ISO inválido')

class EventIn(BaseModel):
    event_id: str | None=None
    node_id: str=Field(pattern=r'^[A-Za-z0-9_-]{1,64}$')
    event_type: str
    confidence: float=Field(ge=0,le=1)
    persistent: bool=False
    detected_at: str | None=None
    source: str='device'
    metadata: dict=Field(default_factory=dict)
    evidence_path: str | None=None
    evidence_type: str | None=None

def ingest(e):
    if e.event_type not in ('chainsaw','person','footsteps','ambient'):raise HTTPException(422,'Clase inválida')
    if e.source not in ('device','manual','demo','local_center'):raise HTTPException(422,'Origen inválido')
    eid=e.event_id or uid()
    try:uuid.UUID(eid)
    except ValueError:raise HTTPException(422,'event_id debe ser UUID')
    at=e.detected_at or now(); et=stamp(at)
    at=datetime.fromtimestamp(et,timezone.utc).isoformat().replace('+00:00','Z')
    with connect() as c:
        existing=c.execute('SELECT body FROM events WHERE id=?',(eid,)).fetchone()
        if existing:
            event=json.loads(existing['body']); incident=next((i for i in rows(c,'incidents') if eid in i['event_ids']),None)
            return dict(event=event,incident=incident)
        if e.evidence_path and not (DATA/'evidence'/Path(e.evidence_path).name).is_file():raise HTTPException(422,'Evidencia local no encontrada')
        node=next((n for n in rows(c,'nodes') if n['id']==e.node_id),dict(id=e.node_id,name=e.node_id,sector='Sin configurar',latitude=None,longitude=None,battery_pct=None,created_at=now()))
        node.update(status='online',last_seen=now());put(c,'nodes',node)
        event=dict(id=eid,**e.model_dump(exclude={'event_id','detected_at'}),detected_at=at,received_at=now())
        put(c,'events',event)
        incident=None
        if e.event_type!='ambient':
            neighbors=[v for v in rows(c,'events') if v['node_id']==e.node_id and v['source']==e.source and abs(stamp(v['detected_at'])-et)<=120]
            saw=any(v['event_type']=='chainsaw' and v['persistent'] for v in neighbors)
            person=any(v['event_type']=='person' for v in neighbors)
            priority='high' if saw and person else 'medium' if saw else 'observation'
            incident=next((i for i in reversed(rows(c,'incidents')) if i['node_id']==e.node_id and i['status']=='pending_review' and any(v['id'] in i['event_ids'] for v in neighbors)),None)
            reason='Motosierra persistente y persona visibles en intervalo cercano.' if priority=='high' else 'Sonido persistente compatible con motosierra; requiere verificación.' if priority=='medium' else 'Indicio secundario; observar sin notificación automática.'
            if not incident:incident=dict(id=uid(),node_id=e.node_id,title='Indicio para inspección',status='pending_review',event_ids=[],assigned_to=None,review_note=None,created_at=now())
            manual_priority=any(a['incident_id']==incident['id'] and a['action']=='operator_review' and 'priority' in a['details'] for a in rows(c,'audit'))
            if manual_priority:priority=incident['priority'];reason=incident['summary']
            incident.update(priority=priority,summary=reason,event_ids=list(dict.fromkeys(incident['event_ids']+[v['id'] for v in neighbors if v['event_type']!='ambient'])),updated_at=now())
            put(c,'incidents',incident);audit(c,incident['id'],'triage',{'priority':priority,'event_id':eid})
        sync_job(c)
    return dict(event=event,incident=incident)

async def process_jobs():
    while True:
        try:
            with connect() as c: jobs=[dict(r) for r in c.execute('SELECT * FROM jobs WHERE next_at<=?',(time.time(),))]
            for job in jobs:
                target=os.getenv('CLOUD_BASE_URL','').rstrip('/')+'/api/sync' if job['kind']=='sync' else os.getenv('N8N_NOTIFY_WEBHOOK','')
                if not target or target=='/api/sync':continue
                if job['attempts']>=8:continue
                try:
                    if job['kind']=='sync':
                        with connect() as c: payload={t:rows(c,t) for t in ('nodes','events','incidents','audit','notifications')}
                        token=os.getenv('CENTER_SYNC_TOKEN','')
                        if not token:continue
                        # Synthetic scenarios stay local and never enter the real-data sync route.
                        payload['nodes']=[n for n in payload['nodes'] if not n['id'].startswith('DEMO')]
                        node_ids={n['id'] for n in payload['nodes']}
                        payload['events']=[e for e in payload['events'] if e['source']!='demo' and e['node_id'] in node_ids]
                        event_ids={e['id'] for e in payload['events']}
                        payload['incidents']=[i for i in payload['incidents'] if i['node_id'] in node_ids and any(eid in event_ids for eid in i['event_ids'])]
                        incident_ids={i['id'] for i in payload['incidents']}
                        payload['audit']=[a for a in payload['audit'] if a['incident_id'] in incident_ids]
                        payload['notifications']=[n for n in payload['notifications'] if n['incident_id'] in incident_ids]
                        async with httpx.AsyncClient(timeout=30) as uploader:
                            for e in payload['events']:
                                path=e.get('evidence_path')
                                if not path:continue
                                cache_key=target+'|'+path
                                with connect() as c:cached=c.execute('SELECT remote_path FROM cloud_evidence WHERE id=?',(cache_key,)).fetchone()
                                if cached:remote=cached['remote_path']
                                else:
                                    local=DATA/'evidence'/Path(path).name
                                    with local.open('rb') as stream:
                                        uploaded=await uploader.post(os.getenv('CLOUD_BASE_URL','').rstrip('/')+'/api/evidence',headers={'Authorization':f'Bearer {token}'},files={'file':(local.name,stream)},data={'node_id':e['node_id']})
                                    uploaded.raise_for_status();remote=uploaded.json()['path']
                                    with connect() as c:c.execute('INSERT OR REPLACE INTO cloud_evidence(id,remote_path) VALUES(?,?)',(cache_key,remote))
                                e['metadata']['local_evidence_path']=path;e['evidence_path']=remote
                    else:payload=json.loads(job['body']);token=os.getenv('N8N_WEBHOOK_TOKEN','')
                    payloads=[payload]
                    if job['kind']=='sync':
                        limits={'nodes':100,'events':1000,'incidents':1000,'audit':2000,'notifications':1000}
                        for records in payload.values():
                            for record in records:
                                for key,value in list(record.items()):
                                    if key.endswith('_at') and isinstance(value,str):record[key]=datetime.fromtimestamp(stamp(value),timezone.utc).isoformat().replace('+00:00','Z')
                        if any(len(payload[k])>limit for k,limit in limits.items()):
                            payloads=[]
                            # Preserve FK order across bounded batches; repeated partial batches upsert by UUID.
                            for table,limit in limits.items():
                                for start in range(0,len(payload[table]),limit):
                                    batch={k:[] for k in limits};batch[table]=payload[table][start:start+limit];payloads.append(batch)
                    async with httpx.AsyncClient(timeout=15) as client:
                        for index,part in enumerate(payloads):
                            response=await client.post(target,json=part,headers={'Authorization':f'Bearer {token}','Idempotency-Key':job['id'] if job['kind']=='notify' else job['id']+f':{index}'});response.raise_for_status()
                    with connect() as c:
                        if job['kind']=='notify':
                            n=get(c,'notifications',job['id']);n.update(last_error=None);put(c,'notifications',n)
                            audit(c,n['incident_id'],'notification_webhook_accepted',{'notification_id':n['id'],'note':'Aceptado por webhook; estado queued hasta callback del proveedor.'});sync_job(c)
                        c.execute('DELETE FROM jobs WHERE id=? AND body=?',(job['id'],job['body']))
                except Exception as exc:
                    with connect() as c:
                        attempt=job['attempts']+1
                        c.execute('UPDATE jobs SET attempts=?,next_at=?,error=? WHERE id=? AND body=?',(attempt,time.time()+min(300,2**attempt),type(exc).__name__,job['id'],job['body']))
                        if job['kind']=='notify':
                            n=get(c,'notifications',job['id']);n.update(attempts=attempt,last_error=type(exc).__name__,status='failed' if attempt>=8 else 'queued');put(c,'notifications',n)
        except Exception:
            logging.exception('Local queue iteration failed; ingest remains available')
        await asyncio.sleep(5)

@asynccontextmanager
async def lifespan(app):
    task=asyncio.create_task(process_jobs())
    yield
    task.cancel()
app=FastAPI(title='Bosque Escucha · Centro local',lifespan=lifespan)
@app.get('/')
def index():return FileResponse(ROOT/'static'/'index.html')
@app.get('/health')
def health():return {'ok':True,'mode':'local'}
@app.get('/api/dashboard',dependencies=[Depends(auth)])
def dashboard():
    with connect() as c:
        result={t:rows(c,t) for t in ('nodes','events','incidents','notifications','audit')}
        result['jobs']=[dict(r) for r in c.execute('SELECT id,kind,attempts,error,next_at FROM jobs')]
    for n in result['nodes']:
        if n.get('last_seen') and time.time()-stamp(n['last_seen'])>30:n['status']='offline'
    return {**result,'configured':True}
@app.post('/api/events',dependencies=[Depends(auth)])
def event(e:EventIn):return ingest(e)
@app.post('/api/evidence',dependencies=[Depends(auth)])
async def upload(file:UploadFile=File(...),node_id:str=Form(...)):
    raw=await file.read(4*1024*1024+1)
    if len(raw)>4*1024*1024:raise HTTPException(413,'Máximo 4 MB')
    ext='jpg' if raw.startswith(b'\xff\xd8\xff') else 'png' if raw.startswith(b'\x89PNG\r\n\x1a\n') else 'wav' if raw.startswith(b'RIFF') and raw[8:12]==b'WAVE' else None
    if not ext:raise HTTPException(415,'Solo JPEG, PNG o WAV')
    name=hashlib.sha256(raw).hexdigest()+'.'+ext;(DATA/'evidence'/name).write_bytes(raw)
    return {'path':name,'type':'audio' if ext=='wav' else 'image'}
@app.get('/api/evidence',dependencies=[Depends(auth)])
def evidence(path:str):
    if Path(path).name!=path:raise HTTPException(400,'Ruta inválida')
    file=DATA/'evidence'/path
    if not file.is_file():raise HTTPException(404,'No existe')
    return FileResponse(file)
@app.patch('/api/incidents/{incident_id}',dependencies=[Depends(auth)])
async def update(incident_id:str,request:Request):
    body=await request.json()
    with connect() as c:
        i=get(c,'incidents',incident_id)
        if 'status' in body:
            allowed={'pending_review':['discarded','verified'],'verified':['assigned','closed'],'assigned':['closed'],'discarded':[],'closed':[]}
            if body['status'] not in allowed[i['status']]:raise HTTPException(409,'Transición inválida')
            if body['status']=='assigned' and not body.get('assigned_to'):raise HTTPException(422,'Falta contacto')
            if body['status']=='discarded' and not body.get('review_note'):raise HTTPException(422,'Falta motivo')
            i['status']=body['status']
        if 'priority' in body:
            if body['priority'] not in ['high','medium','observation'] or not body.get('review_note'):raise HTTPException(422,'Prioridad y motivo requeridos')
            i['priority']=body['priority']
        for k in ('assigned_to','review_note'):
            if k in body:i[k]=body[k]
        i['updated_at']=now();put(c,'incidents',i);audit(c,incident_id,'operator_review',body);sync_job(c)
    return i
@app.post('/api/incidents/{incident_id}/notify',dependencies=[Depends(auth)])
async def notify(incident_id:str,request:Request):
    body=await request.json()
    if body.get('approved') is not True:raise HTTPException(422,'Aprobación explícita requerida')
    with connect() as c:
        i=get(c,'incidents',incident_id)
        if i['status'] not in ('verified','assigned'):raise HTTPException(409,'Verificar incidente primero')
        if not i.get('assigned_to'):raise HTTPException(422,'Asignar contacto acordado primero')
        previous=next((n for n in rows(c,'notifications') if n['incident_id']==incident_id),None)
        if previous:return previous
        n=dict(id=uid(),incident_id=incident_id,channel='whatsapp',status='queued',approved_by='local_operator',created_at=now(),sent_at=None,last_error=None,delivered_at=None,acknowledged_at=None,acknowledged_by=None,attempts=0,next_attempt_at=None,provider_id=None,destination=i['assigned_to'])
        put(c,'notifications',n)
        c.execute('INSERT INTO jobs(id,kind,body) VALUES(?,?,?)',(n['id'],'notify',json.dumps({'notification':n,'incident':i,'recipient':i['assigned_to']})))
        audit(c,incident_id,'notification_approved',{'notification_id':n['id']});sync_job(c)
    return n
@app.post('/api/demo',dependencies=[Depends(auth)])
async def demo(request:Request):
    scenario=(await request.json()).get('scenario','combined')
    if scenario not in ('ambient','chainsaw','combined'):raise HTTPException(422,'Escenario inválido')
    result=ingest(EventIn(node_id='DEMO-01',event_type='ambient' if scenario=='ambient' else 'chainsaw',confidence=.85,persistent=True,source='demo',metadata={'simulated':True}))
    if scenario=='combined':result=ingest(EventIn(node_id='DEMO-01',event_type='person',confidence=.9,source='demo',metadata={'simulated':True}))
    return result

@app.put('/api/nodes/{node_id}',dependencies=[Depends(auth)])
async def configure_node(node_id:str,request:Request):
    body=await request.json()
    lat,lon=body.get('latitude'),body.get('longitude')
    if lat is not None and (not isinstance(lat,(int,float)) or not -90<=lat<=90):raise HTTPException(422,'Latitud inválida')
    if lon is not None and (not isinstance(lon,(int,float)) or not -180<=lon<=180):raise HTTPException(422,'Longitud inválida')
    with connect() as c:
        node=next((n for n in rows(c,'nodes') if n['id']==node_id),dict(id=node_id,status='offline',last_seen=None,created_at=now(),battery_pct=None))
        node.update(name=str(body.get('name',node_id)),sector=str(body.get('sector','Sin configurar')),latitude=lat,longitude=lon)
        put(c,'nodes',node);sync_job(c)
    return node
@app.post('/api/queue/{job_id}/retry',dependencies=[Depends(auth)])
def retry(job_id:str):
    with connect() as c:
        result=c.execute('UPDATE jobs SET attempts=0,next_at=0,error=NULL WHERE id=?',(job_id,))
        if result.rowcount==0:raise HTTPException(404,'Trabajo no encontrado')
    return {'queued':True}

@app.post('/api/notifications/callback')
async def notification_callback(request:Request):
    secret=os.getenv('NOTIFICATION_CALLBACK_SECRET','')
    if not secret or not secrets.compare_digest(request.headers.get('authorization',''),f'Bearer {secret}'):
        raise HTTPException(401,'Callback no autorizado')
    body=await request.json();status=body.get('status')
    if status not in ('sent','delivered','failed','acknowledged'):raise HTTPException(422,'Estado inválido')
    with connect() as c:
        n=get(c,'notifications',body.get('notification_id',''))
        previous=n.copy()
        if status=='acknowledged':
            if not body.get('actor'):raise HTTPException(422,'Identificar quién confirmó')
            if not n.get('acknowledged_at'):n.update(acknowledged_at=now(),acknowledged_by=str(body['actor'])[:200])
        elif status=='delivered':
            if n['status']!='delivered':n.update(status='delivered',delivered_at=now(),sent_at=n.get('sent_at') or now())
        elif status=='sent':
            if n['status'] not in ('sent','delivered'):n.update(status='sent',sent_at=now())
        elif n['status']!='delivered':n.update(status='failed',last_error='Proveedor reportó fallo')
        if body.get('provider_id'):n['provider_id']=str(body['provider_id'])[:300]
        if n!=previous:
            put(c,'notifications',n);audit(c,n['incident_id'],'notification_'+status,{'notification_id':n['id'],'actor':body.get('actor')});sync_job(c)
    return {'notification':n}
