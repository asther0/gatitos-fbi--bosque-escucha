import tempfile,unittest,wave,io
from pathlib import Path
from protocol import Frame,Parser,AUDIO,JPEG,STATUS,acknowledge
from bridge import Spool
class ProtocolTests(unittest.TestCase):
 def test_every_fragment_boundary(self):
  frame=Frame(AUDIO,123,456,0,1,17,'A01',bytes(range(256))*4)
  raw=frame.encode()
  for split in range(len(raw)+1):
   parser=Parser();self.assertEqual(parser.feed(raw[:split])+parser.feed(raw[split:]),[frame])
 def test_crc_and_noise_recovery(self):
  frame=Frame(JPEG,payload=b'\xff\xd8jpeg\xff\xd9');bad=bytearray(frame.encode());bad[-1]^=255;parser=Parser()
  self.assertEqual(parser.feed(b'boot log\r\n'+bad+frame.encode()),[frame]);self.assertEqual(parser.crc_errors,1)
 def test_coalesced_frames_and_ack(self):
  f=Frame(AUDIO,5,8,0,1,payload=b'\0\0');ack=acknowledge(f)
  self.assertEqual(Parser().feed(f.encode()+ack.encode()),[f,ack]);self.assertEqual(ack.sequence,5)
 def test_durable_reassembly_and_duplicates(self):
  with tempfile.TemporaryDirectory() as d:
   spool=Spool(d);f1=Frame(AUDIO,2,10,1,2,payload=b'\2\0');f0=Frame(AUDIO,1,10,0,2,payload=b'\1\0')
   spool.accept(f1);self.assertFalse(spool.pending());key=spool.accept(f0);spool.accept(f0)
   restored=Spool(d);meta,raw,name,mime=restored.payload(restored.pending()[0]);self.assertEqual(meta['capture_id'],key)
   with wave.open(io.BytesIO(raw)) as wav:self.assertEqual(wav.getframerate(),16000);self.assertEqual(wav.readframes(2),b'\1\0\2\0')
   with self.assertRaises(ValueError):spool.accept(Frame(AUDIO,1,10,0,2,payload=b'xx'))
 def test_heartbeat_never_marks_receiver_as_tree(self):
  with tempfile.TemporaryDirectory() as d:
   spool=Spool(d);spool.heartbeat(Frame(STATUS,node='RECEIVER'),{'battery_pct':90});self.assertFalse((Path(d)/'heartbeats').exists())
   spool.heartbeat(Frame(STATUS,node='A01'),{'battery_pct':73,'password':'do-not-store'})
   import json
   record=json.loads((Path(d)/'heartbeats/A01.json').read_text());self.assertEqual(record['body'],{'battery_pct':73})
 def test_reject_unbounded_capture(self):
  with tempfile.TemporaryDirectory() as d:
   with self.assertRaises(ValueError):Spool(d).accept(Frame(AUDIO,count=65535,payload=b'x'))
if __name__=='__main__':unittest.main()
