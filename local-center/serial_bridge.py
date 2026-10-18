"""Diagnostic JSON-lines serial bridge; NOT the PRD binary audio transport."""
import argparse,json,os
from pathlib import Path
import httpx
import serial
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--port',required=True);p.add_argument('--baud',type=int,default=921600);p.add_argument('--url',default='http://127.0.0.1:8765');a=p.parse_args()
token=os.getenv('LOCAL_CENTER_TOKEN') or (Path(__file__).parent/'data/.token').read_text().strip()
with serial.Serial(a.port,a.baud,timeout=1) as port,httpx.Client(headers={'Authorization':'Bearer '+token},timeout=10) as client:
    while True:
        line=port.read_until(b'\n',size=16384)
        if not line:continue
        try:
            payload=json.loads(line)
            if not payload.get('event_id'):raise ValueError('event_id estable requerido para deduplicar')
            response=client.post(a.url+'/api/events',json=payload);response.raise_for_status()
            port.write((json.dumps({'ack':payload['event_id']})+'\n').encode())
        except (ValueError,httpx.HTTPError) as exc:
            print('Sin ACK; el emisor debe retener/reintentar:',type(exc).__name__,flush=True)
