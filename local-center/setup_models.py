"""Explicitly download official weights and export YAMNet for offline CPU use.

Run with requirements-ml.txt installed. No downloads occur in normal server startup.
"""
import argparse,hashlib,json,subprocess,sys
from pathlib import Path

TF_COMMIT='34a21326906b9574fa11c4d6d0a5c534ff039267'
TF_SOURCE=f'https://raw.githubusercontent.com/tensorflow/models/{TF_COMMIT}/research/audioset/yamnet/'
SOURCES={
 'yolo11n.pt':'https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n.pt',
 'yamnet.h5':'https://storage.googleapis.com/audioset/yamnet.h5',
}
def download(url,path):
    if path.is_file() and path.stat().st_size:return
    path.parent.mkdir(parents=True,exist_ok=True)
    partial=path.with_suffix(path.suffix+'.part')
    subprocess.run(['curl','--fail','--location','--max-time','180','--max-filesize','67108864','--output',str(partial),url],check=True)
    partial.replace(path)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--directory',type=Path,default=Path(__file__).parent/'models');parser.add_argument('--vision-only',action='store_true');args=parser.parse_args()
    directory=args.directory.resolve();directory.mkdir(parents=True,exist_ok=True)
    download(SOURCES['yolo11n.pt'],directory/'yolo11n.pt')
    sources={'yolo11n.pt':SOURCES['yolo11n.pt']}
    if not args.vision_only:
        source=directory/'yamnet-source'
        for name in ('params.py','features.py','yamnet.py','yamnet_class_map.csv'):
            download(TF_SOURCE+name,source/name);sources['yamnet-source/'+name]=TF_SOURCE+name
        download(SOURCES['yamnet.h5'],directory/'yamnet.h5');sources['yamnet.h5']=SOURCES['yamnet.h5']
        if not (directory/'yamnet'/'saved_model.pb').is_file():
            import tensorflow as tf
            sys.path.insert(0,str(source))
            import params,yamnet
            class Export(tf.Module):
                def __init__(self):
                    super().__init__();self.network=yamnet.yamnet_frames_model(params.Params());self.network.load_weights(str(directory/'yamnet.h5'))
                    self.class_map=tf.saved_model.Asset(str(source/'yamnet_class_map.csv'))
                @tf.function(input_signature=[tf.TensorSpec([None],tf.float32)])
                def __call__(self,waveform):return tuple(self.network(waveform))
                @tf.function(input_signature=[])
                def class_map_path(self):return self.class_map.asset_path
            tf.saved_model.save(Export(),str(directory/'yamnet'))
    manifest={name:{'url':url,'sha256':hashlib.sha256((directory/name).read_bytes()).hexdigest()} for name,url in sources.items()}
    (directory/'provenance.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(f'YOLO_MODEL_PATH={directory / "yolo11n.pt"}')
    if not args.vision_only:
        print(f'YAMNET_MODEL_PATH={directory / "yamnet"}')
        print(f'YAMNET_CLASS_MAP={directory / "yamnet-source/yamnet_class_map.csv"}')
if __name__=='__main__':main()
