"""BESC v1 little-endian bounded framing, shared by receiver tools and tests."""
from dataclasses import dataclass
import struct,zlib
HEADER=struct.Struct('<4sBBBBIQHHIQ16s')
MAX_PAYLOAD=1024
AUDIO,JPEG,STATUS,CONFIG,ACK=1,2,3,16,128
@dataclass(frozen=True)
class Frame:
    kind:int
    sequence:int=0
    capture:int=0
    index:int=0
    count:int=1
    timestamp_ms:int=0
    node:str='A01'
    payload:bytes=b''
    flags:int=0
    def encode(self):
        if len(self.payload)>MAX_PAYLOAD:raise ValueError('payload exceeds 1024 bytes')
        node=self.node.encode('ascii')
        if not 1<=len(node)<=16:raise ValueError('node must be 1..16 ASCII bytes')
        header=HEADER.pack(b'BESC',1,self.kind,self.flags,HEADER.size,self.sequence,self.capture,self.index,self.count,len(self.payload),self.timestamp_ms,node.ljust(16,b'\0'))
        body=header+self.payload
        return body+struct.pack('<I',zlib.crc32(body))
class Parser:
    def __init__(self):self.buffer=bytearray();self.crc_errors=0;self.invalid_headers=0
    def feed(self,data):
        self.buffer.extend(data);result=[]
        while True:
            start=self.buffer.find(b'BESC')
            if start<0:
                self.buffer[:]=self.buffer[-3:];break
            if start:del self.buffer[:start]
            if len(self.buffer)<HEADER.size:break
            magic,version,kind,flags,size,seq,capture,index,count,length,timestamp,node=HEADER.unpack_from(self.buffer)
            if version!=1 or size!=HEADER.size or length>MAX_PAYLOAD:
                self.invalid_headers+=1;del self.buffer[0];continue
            total=HEADER.size+length+4
            if len(self.buffer)<total:break
            raw=bytes(self.buffer[:total])
            if zlib.crc32(raw[:-4])!=struct.unpack_from('<I',raw,total-4)[0]:
                self.crc_errors+=1;del self.buffer[0];continue
            del self.buffer[:total]
            try:label=node.rstrip(b'\0').decode('ascii')
            except UnicodeDecodeError:self.invalid_headers+=1;continue
            result.append(Frame(kind,seq,capture,index,count,timestamp,label,raw[HEADER.size:-4],flags))
        return result

def acknowledge(frame,status=0):
    return Frame(ACK,frame.sequence,frame.capture,frame.index,frame.count,frame.timestamp_ms,frame.node,bytes([status]),frame.flags)
