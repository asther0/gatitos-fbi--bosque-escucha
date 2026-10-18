#!/usr/bin/env python3
"""USB-only diagnostic echo; generates no evidence or detection events."""
import argparse,json,secrets,time
from protocol import Frame,Parser

def main():
 import serial
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--port',required=True);p.add_argument('--frames',type=int,default=96);a=p.parse_args()
 port=serial.Serial();port.port=a.port;port.baudrate=921600;port.timeout=.1;port.dtr=False;port.rts=False;port.open();decoder=Parser();payload=secrets.token_bytes(1024);start=time.monotonic();completed=0
 try:
  for index in range(a.frames):
   port.write(Frame(17,index,node='USB-TEST',payload=payload).encode());deadline=time.monotonic()+3;received=False
   while time.monotonic()<deadline:
    for frame in decoder.feed(port.read(max(1,min(port.in_waiting,4096)))):
     if frame.kind==129 and frame.sequence==index:
      if frame.payload!=payload:raise ValueError('Echo payload mismatch')
      received=True
    if received:break
   if not received:raise TimeoutError(f'No valid echo for frame {index}')
   completed+=1
 finally:
  elapsed=time.monotonic()-start;port.close();print(json.dumps({'test':'USB echo only, no WiFi or inference','frames':completed,'payload_bytes':completed*1024,'seconds':round(elapsed,3),'payload_bytes_per_second':round(completed*1024/elapsed),'crc_errors':decoder.crc_errors,'invalid_headers':decoder.invalid_headers}))
if __name__=='__main__':main()
