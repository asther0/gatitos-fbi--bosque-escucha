"""Real CPU inference on synthetic negative controls; not a field accuracy test."""
import argparse,csv,json,tempfile,time
from pathlib import Path
import numpy as np
import soundfile as sf
from PIL import Image
from models import AudioDetector,VisionDetector
p=argparse.ArgumentParser();p.add_argument('--directory',type=Path,default=Path(__file__).parent/'models');p.add_argument('--vision-only',action='store_true');a=p.parse_args()
report={'controls':'synthetic silence and blank image; no field accuracy claim'}
with tempfile.TemporaryDirectory() as folder:
    folder=Path(folder);image=folder/'blank.jpg';Image.new('RGB',(320,240),(0,0,0)).save(image)
    start=time.perf_counter();vision=VisionDetector(a.directory/'yolo11n.pt');detected=vision.predict(image)
    report['vision']={'person_detections':len(detected),'load_and_inference_seconds':round(time.perf_counter()-start,3)}
    assert not detected,'Unexpected person on blank image; investigate before demo'
    if not a.vision_only:
        wav=folder/'silence.wav';sf.write(wav,np.zeros(48000,dtype=np.float32),16000,subtype='PCM_16')
        start=time.perf_counter();audio=AudioDetector(str(a.directory/'yamnet'),str(a.directory/'yamnet-source/yamnet_class_map.csv'))
        assert len(audio.names)==521 and 'Chainsaw' in audio.names and 'Walk, footsteps' in audio.names
        detected=audio.predict(wav)
        scores,_,_=audio.model(np.zeros(48000,dtype=np.float32));scores=scores.numpy()
        top=audio.names[int(scores.mean(axis=0).argmax())]
        report['audio']={'events':detected,'top_class':top,'frames':len(scores),'class_count':len(audio.names),'persistence_windows':audio.windows,'history':list(audio.history),'load_and_inference_seconds':round(time.perf_counter()-start,3)}
        assert not detected and top=='Silence'
        assert len(audio.history)==3 and not any(audio.history)
print(json.dumps(report,indent=2))
