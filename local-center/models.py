"""Optional real CPU inference. No model is downloaded or activated implicitly."""
from collections import deque
import csv

class AudioDetector:
    def __init__(self, model_path, class_map_path, threshold=.65, windows=3):
        from pathlib import Path
        if not (Path(model_path)/'saved_model.pb').is_file():raise ValueError('YAMNet SavedModel local requerido')
        import tensorflow as tf
        self.model=tf.saved_model.load(str(model_path))
        with open(class_map_path) as f:self.names=[r['display_name'] for r in csv.DictReader(f)]
        self.threshold=threshold
        self.history=deque(maxlen=windows)
        self.windows=windows
    def predict(self, wav_path):
        import soundfile as sf
        import numpy as np
        wave,rate=sf.read(wav_path,dtype='float32')
        if rate!=16000 or wave.ndim!=1:raise ValueError('WAV mono 16 kHz requerido; convertir antes de inferencia')
        if len(wave)<15600:raise ValueError('Se requiere al menos 0.975 segundos de audio')
        scores,_,_=self.model(wave)
        scores=scores.numpy()
        outputs=[]
        persistent=False
        for row in scores:
            chain=float(row[self.names.index('Chainsaw')])
            self.history.append(chain>=self.threshold)
            persistent=persistent or (len(self.history)==self.windows and all(self.history))
        peak=np.max(scores,axis=0)
        self.last_summary={'top':[{'label':self.names[int(i)],'score':float(peak[i])} for i in np.argsort(peak)[-3:][::-1]],
                           'chainsaw_score':float(peak[self.names.index('Chainsaw')]),'threshold':self.threshold,
                           'persistent':persistent}
        for label,event in [('Chainsaw','chainsaw'),('Walk, footsteps','footsteps')]:
            if label not in self.names:continue
            confidence=float(np.max(scores[:,self.names.index(label)]))
            if confidence>=self.threshold:outputs.append({'event_type':event,'confidence':confidence,'persistent':event=='chainsaw' and persistent})
        return outputs

class VisionDetector:
    def __init__(self,weights,threshold=.5):
        from pathlib import Path
        if not Path(weights).is_file():raise ValueError('Proporciona pesos YOLO locales descargados explícitamente')
        from ultralytics import YOLO
        self.model=YOLO(weights);self.threshold=threshold
    def predict(self,image_path):
        result=self.model.predict(str(image_path),classes=[0],conf=self.threshold,device='cpu',verbose=False)[0]
        boxes=[{'xyxy':box.xyxy[0].tolist(),'confidence':float(box.conf[0])} for box in result.boxes]
        return [] if not boxes else [{'event_type':'person','confidence':max(b['confidence'] for b in boxes),'persistent':False,'metadata':{'boxes':boxes,'model':'YOLO','class':'person'}}]
