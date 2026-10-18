"""Load server-only environment and start the local center on loopback."""
import argparse,os
from pathlib import Path
from dotenv import load_dotenv
import uvicorn
root=Path(__file__).resolve().parent
p=argparse.ArgumentParser();p.add_argument('--env-file',type=Path,default=root.parent/'.env.local');p.add_argument('--cloud-url');p.add_argument('--port',type=int,default=8765);p.add_argument('--host',default='127.0.0.1',help='LAN IP de la laptop para recibir capturas Wi-Fi');a=p.parse_args()
load_dotenv(a.env_file,override=False)
load_dotenv(root/'.env',override=False)
if a.cloud_url:os.environ['CLOUD_BASE_URL']=a.cloud_url
uvicorn.run('app:app',host=a.host,port=a.port,app_dir=str(root))
