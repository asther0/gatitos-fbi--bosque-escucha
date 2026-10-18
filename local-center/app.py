"""Offline command center; bind to a trusted LAN IP for ESP32 Wi-Fi uploads."""
import asyncio, hashlib, ipaddress, json, logging, os, secrets, shutil, sqlite3, subprocess, time, uuid
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
    for table in ('nodes','events','incidents','audit','notifications','captures'):
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
    if et>time.time()+60:raise HTTPException(422,'detected_at no puede superar 60 segundos en el futuro')
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

def is_demo_incident(c,incident):
    if incident['node_id'].upper().startswith('DEMO'):return True
    event_ids=set(incident.get('event_ids',[]))
    return any(e['id'] in event_ids and e['source']=='demo' for e in rows(c,'events'))

async def process_jobs():
    while True:
        try:
            with connect() as c: jobs=[dict(r) for r in c.execute('SELECT * FROM jobs WHERE next_at<=?',(time.time(),))]
            for job in jobs:
                if job['kind']=='notify':
                    with connect() as c:
                        stored=json.loads(job['body'])
                        incident=get(c,'incidents',stored['incident']['id'])
                        if is_demo_incident(c,incident) or is_demo_incident(c,stored['incident']):
                            n=get(c,'notifications',job['id']);n.update(status='blocked',last_error='DEMO: envío externo bloqueado')
                            put(c,'notifications',n);c.execute('DELETE FROM jobs WHERE id=?',(job['id'],))
                            audit(c,incident['id'],'demo_notification_blocked',{'notification_id':n['id']})
                            continue
                target=os.getenv('CLOUD_BASE_URL','').rstrip('/')+'/api/sync' if job['kind']=='sync' else os.getenv('N8N_NOTIFY_WEBHOOK','')
                if not target or target=='/api/sync':continue
                if job['attempts']>=8:continue
                try:
                    if job['kind']=='sync':
                        with connect() as c: payload={t:rows(c,t) for t in ('nodes','events','incidents','audit','notifications')}
                        token=os.getenv('CENTER_SYNC_TOKEN','')
                        if not token:continue
                        # Built-in synthetic scenarios stay local. Recorded mic captures on a
                        # DEMO-prefixed node can sync as visibly marked test data; notification
                        # guards still prevent those nodes from sending external alerts.
                        payload['nodes']=[n for n in payload['nodes'] if n['id']!='DEMO-01']
                        node_ids={n['id'] for n in payload['nodes']}
                        payload['events']=[e for e in payload['events'] if e['source']!='demo' and e['node_id'] in node_ids]
                        event_ids={e['id'] for e in payload['events']}
                        payload['incidents']=[i for i in payload['incidents'] if i['node_id'] in node_ids and any(eid in event_ids for eid in i['event_ids'])]
                        incident_ids={i['id'] for i in payload['incidents']}
                        payload['audit']=[a for a in payload['audit'] if a['incident_id'] in incident_ids]
                        payload['notifications']=[n for n in payload['notifications'] if n['incident_id'] in incident_ids]
                        async with httpx.AsyncClient(timeout=30) as uploader:
                            # Storage ingestion validates node ownership/existence before accepting a blob.
                            for start in range(0,len(payload['nodes']),100):
                                prerequisite={k:[] for k in payload}
                                prerequisite['nodes']=payload['nodes'][start:start+100]
                                for n in prerequisite['nodes']:
                                    for k in ('created_at','last_seen'):
                                        if n.get(k):n[k]=datetime.fromtimestamp(stamp(n[k]),timezone.utc).isoformat().replace('+00:00','Z')
                                registered=await uploader.post(target,json=prerequisite,headers={'Authorization':f'Bearer {token}'})
                                registered.raise_for_status()
                            for e in payload['events']:
                                path=e.get('evidence_path')
                                if not path:continue
                                cache_key=target+'|'+e['node_id']+'|'+path
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
    analysis=asyncio.create_task(process_captures())
    yield
    task.cancel();analysis.cancel()
app=FastAPI(title='Bosque Escucha · Centro local',lifespan=lifespan)
@app.get('/')
def index():return FileResponse(ROOT/'static'/'index.html')
@app.get('/health')
def health():return {'ok':True,'mode':'local'}
@app.get('/api/local-session')
def local_session(request:Request):
    try:
        local=ipaddress.ip_address(request.client.host).is_loopback and request.url.hostname in ('127.0.0.1','localhost','::1')
    except (ValueError,AttributeError):
        local=False
    if not local:raise HTTPException(403,'Acceso disponible solo en esta Mac')
    return {'token':TOKEN}
@app.get('/api/dashboard',dependencies=[Depends(auth)])
def dashboard():
    with connect() as c:
        result={t:rows(c,t) for t in ('nodes','events','incidents','notifications','audit')}
        result['captures']=rows(c,'captures')
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
        demo=is_demo_incident(c,i)
        if demo:n.update(status='blocked',last_error='DEMO: aprobación simulada, envío externo bloqueado')
        put(c,'notifications',n)
        if not demo:c.execute('INSERT INTO jobs(id,kind,body) VALUES(?,?,?)',(n['id'],'notify',json.dumps({'notification':n,'incident':i,'recipient':i['assigned_to']})))
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
    try:EventIn(node_id=node_id,event_type='ambient',confidence=0)
    except ValueError:raise HTTPException(422,'node_id debe usar A-Z, a-z, 0-9, guion o guion bajo; máximo 64')
    body=await request.json()
    if any(len(str(body.get(k,'')))>200 for k in ('name','sector')):raise HTTPException(422,'Nombre y sector máximo 200 caracteres')
    lat,lon=body.get('latitude'),body.get('longitude')
    if lat is not None and (isinstance(lat,bool) or not isinstance(lat,(int,float)) or not -90<=lat<=90):raise HTTPException(422,'Latitud inválida')
    if lon is not None and (isinstance(lon,bool) or not isinstance(lon,(int,float)) or not -180<=lon<=180):raise HTTPException(422,'Longitud inválida')
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
    if status in ('sent','delivered') and not str(body.get('provider_id') or '').strip():raise HTTPException(422,'provider_id requerido para envío o entrega')
    with connect() as c:
        n=get(c,'notifications',body.get('notification_id',''))
        if is_demo_incident(c,get(c,'incidents',n['incident_id'])):raise HTTPException(409,'DEMO no admite confirmación de envío externo')
        previous=n.copy()
        if status=='acknowledged':
            if not body.get('actor'):raise HTTPException(422,'Identificar quién confirmó')
            if not n.get('acknowledged_at'):n.update(acknowledged_at=now(),acknowledged_by=str(body['actor'])[:200])
        elif status=='delivered':
            if n['status']!='delivered':n.update(status='delivered',delivered_at=now(),sent_at=n.get('sent_at') or now())
        elif status=='sent':
            if n['status'] not in ('sent','delivered'):n.update(status='sent',sent_at=now())
        elif n['status'] not in ('sent','delivered'):n.update(status='failed',last_error='Proveedor reportó fallo')
        if body.get('provider_id'):n['provider_id']=str(body['provider_id'])[:300]
        if n!=previous:
            put(c,'notifications',n);audit(c,n['incident_id'],'notification_'+status,{'notification_id':n['id'],'actor':body.get('actor')});sync_job(c)
    return {'notification':n}


def analysis_configuration(kind):
    if os.getenv('AUTO_ANALYZE','').lower() not in ('1','true','yes'):
        return 'AUTO_ANALYZE deshabilitado; captura guardada sin clasificación.'
    required=('YAMNET_MODEL_PATH','YAMNET_CLASS_MAP') if kind=='audio' else ('YOLO_MODEL_PATH',)
    missing=[key for key in required if not os.getenv(key) or not Path(os.environ[key]).exists()]
    return 'Modelos locales no configurados: '+', '.join(missing) if missing else None

MODEL_CACHE={}
VOICE_LAST={}

def announce_chainsaw(node_id):
    if os.getenv('VOICE_ALERT','').lower() not in ('1','true','yes'):
        return False
    if not shutil.which('say'):
        logging.warning('VOICE_ALERT requested but macOS say is unavailable')
        return False
    cooldown=max(0,int(os.getenv('VOICE_ALERT_COOLDOWN_SECONDS','90')))
    current=time.monotonic()
    if current-VOICE_LAST.get(node_id,-float('inf'))<cooldown:
        return False
    subprocess.Popen(['say','-v','Paulina',
                      'Alerta. Posible sonido de motosierra detectado. Zona restringida. Identifíquese, por favor.'],
                     stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    VOICE_LAST[node_id]=current
    return True

def analyze_capture(capture):
    from models import AudioDetector,VisionDetector
    kind=capture['type'];error=analysis_configuration(kind)
    if error:raise RuntimeError(error)
    if kind not in MODEL_CACHE:
        MODEL_CACHE[kind]=AudioDetector(os.environ['YAMNET_MODEL_PATH'],os.environ['YAMNET_CLASS_MAP']) if kind=='audio' else VisionDetector(os.environ['YOLO_MODEL_PATH'])
    detector=MODEL_CACHE[kind]
    if kind=='audio':detector.history.clear() # Do not correlate discontinuous clips or different nodes.
    detections=detector.predict(DATA/'evidence'/capture['path'])
    if kind=='audio':capture['analysis_summary']=getattr(detector,'last_summary',None)
    for detection in detections:
        detection['metadata']={**detection.get('metadata',{}),'capture_id':capture['id'],'model':'YAMNet' if kind=='audio' else 'YOLO'}
        result=ingest(EventIn(event_id=str(uuid.uuid5(uuid.UUID(capture['id']),detection['event_type'])),node_id=capture['node_id'],detected_at=capture['detected_at'],source='local_center',evidence_path=capture['path'],evidence_type=kind,**detection))
        if detection['event_type']=='chainsaw' and detection.get('persistent') and result['incident']:
            announce_chainsaw(capture['node_id'])
    return len(detections)

async def process_captures():
    while True:
        with connect() as c: pending=[r for r in rows(c,'captures') if r['analysis_status']=='queued']
        for capture in pending:
            try:
                count=await asyncio.to_thread(analyze_capture,capture)
                capture.update(analysis_status='complete',detections=count,analysis_error=None)
            except Exception as exc:
                capture.update(analysis_status='failed',analysis_error=f'{type(exc).__name__}: {exc}')
            with connect() as c:put(c,'captures',capture)
        await asyncio.sleep(1)

@app.post('/api/raw',dependencies=[Depends(auth)])
async def raw_capture(file:UploadFile=File(...),node_id:str=Form(...),capture_id:str|None=Form(None),detected_at:str|None=Form(None)):
    # Validate metadata before storing, then persist evidence even if inference is unavailable.
    try:EventIn(node_id=node_id,event_type='ambient',confidence=0)
    except ValueError:raise HTTPException(422,'node_id inválido')
    capture_id=capture_id or uid()
    try:uuid.UUID(capture_id)
    except ValueError:raise HTTPException(422,'capture_id debe ser UUID estable')
    timestamp=stamp(detected_at or now())
    if timestamp>time.time()+60:raise HTTPException(422,'detected_at no puede superar 60 segundos en el futuro')
    at=datetime.fromtimestamp(timestamp,timezone.utc).isoformat().replace('+00:00','Z')
    uploaded=await upload(file,node_id)
    with connect() as c:
        previous=c.execute('SELECT body FROM captures WHERE id=?',(capture_id,)).fetchone()
        if previous:
            previous=json.loads(previous['body'])
            if previous['node_id']!=node_id or previous['path']!=uploaded['path']:raise HTTPException(409,'capture_id ya corresponde a otra captura')
            return previous
        error=analysis_configuration(uploaded['type'])
        capture=dict(id=capture_id,capture_id=capture_id,node_id=node_id,**uploaded,detected_at=at,created_at=now(),analysis_status='blocked' if error else 'queued',analysis_error=error,detections=None)
        put(c,'captures',capture)
        node=next((n for n in rows(c,'nodes') if n['id']==node_id),dict(id=node_id,name=node_id,sector='Sin configurar',latitude=None,longitude=None,battery_pct=None,created_at=now()))
        node.update(status='online',last_seen=now());put(c,'nodes',node);sync_job(c)
    return capture

@app.post('/api/captures/{capture_id}/retry',dependencies=[Depends(auth)])
def retry_capture(capture_id:str):
    with connect() as c:
        capture=get(c,'captures',capture_id)
        error=analysis_configuration(capture['type'])
        if error:raise HTTPException(409,error)
        capture.update(analysis_status='queued',analysis_error=None);put(c,'captures',capture)
    return capture


@app.post('/api/nodes/{node_id}/heartbeat',dependencies=[Depends(auth)])
async def heartbeat(node_id:str,request:Request):
    try:EventIn(node_id=node_id,event_type='ambient',confidence=0)
    except ValueError:raise HTTPException(422,'node_id inválido')
    body=await request.json()
    status=body.get('status','online')
    if status not in ('online','offline','maintenance'):raise HTTPException(422,'Estado de nodo inválido')
    battery=body.get('battery_pct')
    if battery is not None and (isinstance(battery,bool) or not isinstance(battery,(int,float)) or not 0<=battery<=100):raise HTTPException(422,'battery_pct debe estar entre 0 y 100')
    with connect() as c:
        node=next((n for n in rows(c,'nodes') if n['id']==node_id),dict(id=node_id,name=node_id,sector='Sin configurar',latitude=None,longitude=None,battery_pct=None,created_at=now()))
        node.update(last_seen=now(),status=status)
        if 'battery_pct' in body:node['battery_pct']=battery
        put(c,'nodes',node);sync_job(c)
    return {'node':node}

from mvp_controls import install_controls
install_controls(app, auth, TOKEN, connect, rows)
