#!/usr/bin/env python3
"""Send a real PCM16 WAV or JPEG over LAN using the exact Bill/node contract."""
import argparse,secrets,socket,time,wave
from pathlib import Path
from protocol import AUDIO,JPEG,ACK,Frame,Parser

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('file');p.add_argument('--host',required=True);p.add_argument('--port',type=int,default=3333);p.add_argument('--node',default='A01');a=p.parse_args();file=Path(a.file)
 if file.suffix.lower()=='.wav':
  with wave.open(str(file)) as w:
   if (w.getnchannels(),w.getsampwidth(),w.getframerate())!=(1,2,16000):raise ValueError('WAV must be PCM16 mono 16000 Hz')
   raw=w.readframes(w.getnframes());kind=AUDIO
 else:raw=file.read_bytes();kind=JPEG
 if not 0<len(raw)<=2*1024*1024:raise ValueError('Capture must be 1 byte..2 MiB')
 capture=secrets.randbits(64);timestamp=int(time.time()*1000);chunks=[raw[i:i+1024] for i in range(0,len(raw),1024)];decoder=Parser();started=time.monotonic()
 with socket.create_connection((a.host,a.port),timeout=5) as client:
  client.settimeout(3)
  for index,chunk in enumerate(chunks):
   frame=Frame(kind,index,capture,index,len(chunks),timestamp,a.node,chunk,1)
   for attempt in range(5):
    client.sendall(frame.encode());accepted=False
    deadline=time.monotonic()+3
    while time.monotonic()<deadline:
     try:data=client.recv(4096)
     except socket.timeout:break
     if not data:raise ConnectionError('Receiver disconnected')
     for ack in decoder.feed(data):
      if ack.kind==ACK and ack.sequence==frame.sequence and ack.capture==capture and ack.index==index:
       if ack.payload==b'\0':accepted=True
       else:time.sleep(.2)
     if accepted:break
    if accepted:break
   else:raise TimeoutError(f'No durable ACK for fragment {index}; retain capture {capture} for retry')
 elapsed=time.monotonic()-started;print(f'{len(raw)} bytes persisted through receiver in {elapsed:.2f}s ({len(raw)/elapsed:.0f} bytes/s); capture={capture}')
if __name__=='__main__':main()
