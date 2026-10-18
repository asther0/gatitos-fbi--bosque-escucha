"""Double-click launcher: one center, browser login, LAN intake and local controls."""
import os
from pathlib import Path
import signal
import subprocess
import threading
import time
from urllib.request import urlopen

from dotenv import load_dotenv
import uvicorn

ROOT = Path(__file__).resolve().parent
os.chdir(ROOT.parent)
load_dotenv(ROOT.parent / '.env.local', override=False)
load_dotenv(ROOT / '.env', override=False)
os.environ['VOICE_ALERT'] = '1'


def previous_center():
    result = subprocess.run(['lsof', '-t', '-iTCP:8765', '-sTCP:LISTEN'], capture_output=True, text=True)
    for value in set(result.stdout.split()):
        pid = int(value)
        args = subprocess.check_output(['ps', '-p', value, '-o', 'command='], text=True)
        cwd = subprocess.run(['lsof', '-a', '-p', value, '-d', 'cwd', '-Fn'], capture_output=True, text=True).stdout
        known_path = any(line == 'n' + str(path) for path in (ROOT, ROOT.parent) for line in cwd.splitlines())
        if not known_path or not any(name in args for name in ('local-center/run.py', 'local-center/mvp.py')):
            raise RuntimeError('El puerto 8765 está ocupado por otra aplicación. Cierra ese servidor antes de abrir el MVP.')
        os.kill(pid, signal.SIGTERM)
    for _ in range(30):
        occupied = subprocess.run(['lsof', '-t', '-iTCP:8765', '-sTCP:LISTEN'], capture_output=True, text=True).stdout
        if not occupied.strip():
            return
        time.sleep(.2)
    raise RuntimeError('El centro anterior sigue cerrándose. Vuelve a abrir el iniciador en unos segundos.')


def main():
    previous_center()
    from app import app

    def open_dashboard():
        for _ in range(50):
            try:
                with urlopen('http://127.0.0.1:8765/health', timeout=1) as response:
                    if response.status == 200:
                        subprocess.run(['open', 'http://127.0.0.1:8765/'], check=True)
                        return
            except Exception:
                time.sleep(.2)
        print('No se pudo abrir el navegador. Revisa el error del servidor en esta ventana.')

    threading.Thread(target=open_dashboard, daemon=True).start()
    print('\nBOSQUE ESCUCHA · MVP\nEl panel se abre en el navegador. Deja esta ventana abierta.\n')
    uvicorn.run(app, host='0.0.0.0', port=8765)


if __name__ == '__main__':
    main()
