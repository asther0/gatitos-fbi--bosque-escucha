"""Explicitly run an installed local model, upload evidence, and ingest detections."""
import argparse, os, uuid
from pathlib import Path
import httpx
from models import AudioDetector, VisionDetector
p=argparse.ArgumentParser();p.add_argument('file');p.add_argument('--node',required=True);p.add_argument('--kind',choices=['audio','image'],required=True);p.add_argument('--model',required=True);p.add_argument('--class-map');p.add_argument('--url',default='http://127.0.0.1:8765');a=p.parse_args()
token=os.environ.get('LOCAL_CENTER_TOKEN') or (Path(__file__).parent/'data/.token').read_text().strip()
if a.kind=='audio' and not a.class_map:p.error('--class-map requerido para YAMNet')
detector=AudioDetector(a.model,a.class_map) if a.kind=='audio' else VisionDetector(a.model)
detections=detector.predict(a.file)
with httpx.Client(headers={'Authorization':'Bearer '+token},timeout=60) as c:
    with open(a.file,'rb') as f:r=c.post(a.url+'/api/evidence',files={'file':(Path(a.file).name,f)},data={'node_id':a.node})
    r.raise_for_status();evidence=r.json()
    for detection in detections:
        payload={'event_id':str(uuid.uuid4()),'node_id':a.node,'source':'local_center','evidence_path':evidence['path'],'evidence_type':evidence['type'],**detection}
        r=c.post(a.url+'/api/events',json=payload);r.raise_for_status();print(r.json())
print(f'Detecciones reales emitidas: {len(detections)}. Sin detecciones no se inventa un evento.')
