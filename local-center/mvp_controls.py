"""Mac-only controls. Audio still travels from ESP32 to the center over Wi-Fi."""
import importlib.util
import ipaddress
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import wave
from contextlib import contextmanager

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('mic_provision', ROOT.parent / 'firmware/mic_wifi/provision.py')
serial = importlib.util.module_from_spec(spec)
spec.loader.exec_module(serial)
LOCK = threading.Lock()


def wifi_ip():
    try:
        return serial.lan_ip('en0')
    except subprocess.CalledProcessError:
        return None


def ports():
    return sorted(str(p) for pattern in ('cu.usbserial*', 'cu.SLAB_USBtoUART*', 'cu.usbmodem*')
                  for p in Path('/dev').glob(pattern))


def wifi_mask():
    try:
        return subprocess.check_output(['ipconfig', 'getoption', 'en0', 'subnet_mask'], text=True).strip()
    except subprocess.CalledProcessError:
        return None


def align_center(fd, state):
    # Association can precede the DHCP lease when switching from the hotspot.
    # Keep the user's single click pending while macOS obtains its address.
    host = None
    for attempt in range(13):
        candidate = wifi_ip()
        try:
            usable = candidate and not ipaddress.ip_address(candidate).is_link_local
        except ValueError:
            usable = False
        if usable:
            host = candidate
            break
        if attempt < 12:
            time.sleep(1)
    if not host:
        raise HTTPException(409, 'La Mac aún no tiene una dirección Wi-Fi válida. En Ajustes → Wi-Fi → TP-Link → Detalles → TCP/IP, pulsa «Renovar concesión DHCP» y vuelve a probar.')
    fields = dict(part.split('=', 1) for part in state.split() if '=' in part)
    if fields.get('wifi') != 'connected':
        raise HTTPException(409, 'El ESP32 perdió el Wi-Fi. Enciende el TP-Link y revisa «Configurar Wi-Fi».')
    mask = wifi_mask()
    try:
        same_network = bool(mask) and ipaddress.ip_address(fields.get('ip', '')) in ipaddress.ip_network(f'{host}/{mask}', strict=False)
    except ValueError:
        same_network = False
    if not same_network:
        raise HTTPException(409, 'La Mac está en otra red. Conéctala al Wi-Fi del TP-Link y vuelve a probar.')
    if fields.get('ip') == host:
        raise HTTPException(409, 'La Mac y el ESP32 tienen la misma IP. Reconecta el Wi-Fi de la Mac para renovar su dirección.')
    if fields.get('center') != host:
        if fields.get('protocol') != '2':
            raise HTTPException(409, 'Cambió la IP de la Mac. Abre «Configurar Wi-Fi» para actualizarla en el ESP32.')
        os.write(fd, ('H\t' + host + '\n').encode())
        wait_line(fd, ('CENTER_UPDATED',), 5)


def wait_line(fd, prefixes, timeout=25):
    for line in serial.lines_until(fd, timeout):
        if line.startswith(('UPLOAD_ERROR', 'CAPTURE_ERROR', 'MIC_WIFI_ERROR', 'WIFI_DISCONNECTED', 'CONFIG_ERROR', 'CENTER_ERROR')):
            raise HTTPException(409, 'El ESP32 informó: ' + line)
        if line.startswith(prefixes):
            return line
    raise HTTPException(504, 'El ESP32 no respondió. Comprueba USB, Wi-Fi del TP-Link y alimentación.')


@contextmanager
def board():
    if not LOCK.acquire(blocking=False):
        raise HTTPException(409, 'Hay una prueba en curso. Espera a que termine.')
    fd = None
    try:
        available = ports()
        if not available:
            raise HTTPException(409, 'Conecta el ESP32 por USB a esta Mac.')
        if len(available) != 1:
            raise HTTPException(409, 'Hay varios dispositivos USB seriales. Deja conectado solo el ESP32 de esta prueba.')
        occupied = subprocess.run(['lsof', '-t', available[0]], capture_output=True, text=True).stdout.strip()
        if occupied:
            raise HTTPException(409, 'Cierra el monitor serial de Arduino (su ventana o Ctrl+C). Después vuelve a pulsar el botón aquí.')
        fd = serial.serial_port(available[0])
        os.write(fd, b'S')
        status = wait_line(fd, ('STATUS wifi=',), 18)
        yield fd, status
    except OSError as exc:
        raise HTTPException(409, 'No se pudo usar el ESP32. Revisa el cable USB y cierra el monitor serial.') from exc
    finally:
        if fd is not None:
            os.close(fd)
        LOCK.release()


@contextmanager
def sample_playback():
    sample = ROOT.parent / '.local/wws-chainsaw-clip.wav'
    if not sample.is_file():
        raise HTTPException(409, 'Falta el audio local de prueba de motosierra.')
    process = None
    with tempfile.TemporaryDirectory(prefix='bosque-sound-') as folder:
        with wave.open(str(sample), 'rb') as source:
            params, frames = source.getparams(), source.readframes(source.getnframes())
        repeated = Path(folder) / 'motosierra.wav'
        with wave.open(str(repeated), 'wb') as target:
            target.setparams(params)
            target.writeframes(frames * 20)
        try:
            process = subprocess.Popen(['afplay', str(repeated)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            time.sleep(1)
            if process.poll() is not None:
                raise HTTPException(409, 'No se pudo reproducir el sonido en la Mac. Revisa la salida de audio.')
            yield
        finally:
            if process is not None and process.poll() is None:
                process.terminate()
                process.wait(timeout=5)


class Configure(BaseModel):
    ssid: str = Field(min_length=1, max_length=32)
    password: str = Field(max_length=64)


class Action(BaseModel):
    action: str = Field(pattern='^(capture|test|start|stop)$')


def install_controls(app, auth, token, connect, rows):
    def local_only(request: Request):
        # Hardware/audio controls are available only on this laptop, never to LAN peers.
        try:
            local = ipaddress.ip_address(request.client.host).is_loopback
        except ValueError:
            local = False
        if not local:
            raise HTTPException(403, 'Abre el iniciador en la Mac para usar los controles del ESP32.')

    dependencies = [Depends(auth), Depends(local_only)]

    @app.get('/api/mvp/status', dependencies=dependencies)
    def status():
        return {'ip': wifi_ip(), 'ports': ports(), 'busy': LOCK.locked()}

    @app.post('/api/mvp/configure', dependencies=dependencies)
    def configure(body: Configure):
        host = wifi_ip()
        if not host:
            raise HTTPException(409, 'Conecta primero la Mac al Wi-Fi del TP-Link.')
        if any(c in body.ssid + body.password for c in '\t\r\n\x00'):
            raise HTTPException(422, 'El nombre y la clave Wi-Fi no admiten saltos de línea ni tabuladores.')
        with board() as (fd, _):
            os.write(fd, ('C\t' + '\t'.join((body.ssid, body.password, host, token, 'DEMO-ESP32-WIFI')) + '\n').encode())
            wait_line(fd, ('WIFI_CONNECTED',), 18)
        return {'message': 'ESP32 conectado al Wi-Fi. Ya puedes probar o activar la escucha.'}

    @app.post('/api/mvp/action', dependencies=dependencies)
    def action(body: Action):
        with board() as (fd, state):
            if body.action == 'stop':
                os.write(fd, b'D')
                wait_line(fd, ('AUTO_OFF',), 5)
                return {'message': 'Escucha automática detenida.'}
            align_center(fd, state)
            if body.action == 'start':
                os.write(fd, b'E')
                wait_line(fd, ('AUTO_ON',), 5)
                return {'message': 'Escucha activa: graba 3 segundos cada 5 segundos. Mantén el centro abierto.'}
            was_auto = 'auto=on' in state
            os.write(fd, b'D')
            wait_line(fd, ('AUTO_OFF',), 5)
            with connect() as c:
                previous = {item['id'] for item in rows(c, 'captures')}

            def upload():
                os.write(fd, b'W')
                line = wait_line(fd, ('UPLOAD_OK',), 30)
                if line != 'UPLOAD_OK status=200':
                    raise HTTPException(409, 'El centro no aceptó el audio: ' + line)

            try:
                if body.action == 'test':
                    with sample_playback():
                        upload()
                else:
                    upload()
            finally:
                if was_auto:
                    os.write(fd, b'E')
                    wait_line(fd, ('AUTO_ON',), 5)
            with connect() as c:
                captured = [item for item in rows(c, 'captures') if item['id'] not in previous and item['node_id'] == 'DEMO-ESP32-WIFI']
            return {'message': 'Audio enviado por Wi-Fi. Analizando en la Mac…',
                    'capture_id': captured[-1]['id'] if captured else None}
