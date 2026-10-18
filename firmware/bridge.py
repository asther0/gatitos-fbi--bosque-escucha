#!/usr/bin/env python3
"""Persist BESC captures from ESP32 USB, then deliver real WAV/JPEG to /api/raw.
No classification or detection scores are invented here. Upload retry survives restart.
"""
import argparse,io,json,os,re,threading,time,uuid,wave
from datetime import datetime,timezone
from pathlib import Path
from protocol import AUDIO,JPEG,STATUS,CONFIG,Frame,Parser,acknowledge
MAX_CAPTURE=2*1024*1024
NAMESPACE=uuid.UUID('2877f655-2410-4b33-8f5a-3242973a2a99')
class Spool:
    def __init__(self,root):self.root=Path(root);self.root.mkdir(parents=True,exist_ok=True,mode=0o700);os.chmod(self.root,0o700)
    def accept(self,frame):
        if frame.kind not in (AUDIO,JPEG):raise ValueError('unsupported capture type')
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,16}',frame.node):raise ValueError('invalid node')
        if not 1<=frame.count<=MAX_CAPTURE//1024 or not 0<=frame.index<frame.count:raise ValueError('invalid fragment counts')
        if not frame.payload:raise ValueError('empty fragment')
        key=str(uuid.uuid5(NAMESPACE,f'{frame.node}:{frame.capture}'))
        folder=self.root/key;folder.mkdir(exist_ok=True,mode=0o700)
        meta={'capture_id':key,'node_id':frame.node,'kind':frame.kind,'count':frame.count,'timestamp_ms':frame.timestamp_ms,'flags':frame.flags}
        metadata=folder/'metadata.json'
        if metadata.exists():
            if json.loads(metadata.read_text())!=meta:raise ValueError('capture metadata changed')
        else:atomic_write(metadata,json.dumps(meta).encode())
        part=folder/f'{frame.index:04d}.part'
        if part.exists():
            if part.read_bytes()!=frame.payload:raise ValueError('conflicting duplicate fragment')
        else:atomic_write(part,frame.payload)
        # Complete marker only after every fragment has been fsynced.
        if not (folder/'complete').exists() and all((folder/f'{i:04d}.part').exists() for i in range(frame.count)):
            atomic_write(folder/'complete',b'1')
        return key
    def pending(self):
        return [p.parent for p in self.root.glob('*/complete') if not (p.parent/'uploaded.json').exists()]
    def payload(self,folder):
        meta=json.loads((folder/'metadata.json').read_text());raw=b''.join((folder/f'{i:04d}.part').read_bytes() for i in range(meta['count']))
        if len(raw)>MAX_CAPTURE:raise ValueError('capture too large')
        if meta['kind']==AUDIO:
            if len(raw)%2:raise ValueError('PCM16 capture has odd length')
            output=io.BytesIO()
            with wave.open(output,'wb') as wav:wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(16000);wav.writeframes(raw)
            return meta,output.getvalue(),'capture.wav','audio/wav'
        if not raw.startswith(b'\xff\xd8') or not raw.endswith(b'\xff\xd9'):raise ValueError('invalid JPEG boundaries')
        return meta,raw,'capture.jpg','image/jpeg'
def atomic_write(path,data):
    temp=path.with_suffix(path.suffix+'.tmp')
    with open(temp,'wb') as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())
    os.replace(temp,path)
    fd=os.open(path.parent,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)
def uploader(spool,url,token,stop):
    import httpx
    with httpx.Client(headers={'Authorization':'Bearer '+token},timeout=60) as client:
        while not stop.is_set():
            for folder in spool.pending():
                try:
                    meta,raw,name,mime=spool.payload(folder);fields={'node_id':meta['node_id'],'capture_id':meta['capture_id']}
                    if meta['flags']&1 and 1577836800000<=meta['timestamp_ms']<=4102444800000:fields['detected_at']=datetime.fromtimestamp(meta['timestamp_ms']/1000,timezone.utc).isoformat()
                    response=client.post(url.rstrip('/')+'/api/raw',files={'file':(name,raw,mime)},data=fields);response.raise_for_status()
                    result=response.json();atomic_write(folder/'uploaded.json',json.dumps(result).encode());print('capture uploaded',meta['capture_id'],'analysis:',result.get('analysis_status','unknown'),flush=True)
                except Exception as error:print('capture retained for retry',folder.name,type(error).__name__,str(error)[:180],flush=True)
            stop.wait(5)
def main():
    import serial
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--port',required=True);parser.add_argument('--baud',type=int,default=921600);parser.add_argument('--url',default='http://127.0.0.1:8765');parser.add_argument('--spool',default=str(Path.home()/'.bosque-escucha/serial-spool'));parser.add_argument('--token-file',default=str(Path(__file__).resolve().parents[1]/'local-center/data/.token'));parser.add_argument('--wifi-config',help='private JSON file with ssid/password; provision only');parser.add_argument('--status-seconds',type=int,default=20);args=parser.parse_args()
    # Open without toggling DTR/RTS: do not reset receiver on every bridge restart.
    port=serial.Serial();port.port=args.port;port.baudrate=args.baud;port.timeout=.2;port.dtr=False;port.rts=False;port.open();decoder=Parser();stop=threading.Event();thread=None
    if args.wifi_config:
        config=json.loads(Path(args.wifi_config).read_text());payload=config['ssid'].encode()+b'\0'+config['password'].encode();port.write(Frame(CONFIG,node='BASE',payload=payload).encode());deadline=time.monotonic()+args.status_seconds
    else:
        token=os.getenv('LOCAL_CENTER_TOKEN') or Path(args.token_file).read_text().strip();spool=Spool(args.spool);thread=threading.Thread(target=uploader,args=(spool,args.url,token,stop),daemon=True);thread.start();deadline=None
    configured_connected=False
    try:
        while deadline is None or time.monotonic()<deadline:
            for frame in decoder.feed(port.read(max(1,min(port.in_waiting,4096)))):
                if frame.kind==STATUS:
                    # Status may include IP but never credentials.
                    try:
                        status=json.loads(frame.payload);print('receiver status',status,flush=True)
                        configured_connected=configured_connected or bool(status.get('wifi_connected'))
                    except (ValueError,UnicodeError):print('status frame received',flush=True)
                    port.write(acknowledge(frame).encode())
                elif frame.kind in (AUDIO,JPEG) and not args.wifi_config:
                    try:spool.accept(frame);port.write(acknowledge(frame).encode())
                    except (ValueError,OSError) as error:print('fragment rejected',type(error).__name__,str(error),flush=True);port.write(acknowledge(frame,2).encode())
    except KeyboardInterrupt:pass
    finally:
        stop.set();port.close()
        if thread:thread.join(timeout=2)
        print('decoder CRC errors:',decoder.crc_errors,'invalid headers:',decoder.invalid_headers)
    if args.wifi_config and not configured_connected:raise SystemExit('WiFi association not confirmed; configuration retained for reconnect.')
if __name__=='__main__':main()
