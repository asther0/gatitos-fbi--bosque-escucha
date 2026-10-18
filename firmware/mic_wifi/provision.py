#!/usr/bin/env python3
"""Configure ESP32 Wi-Fi microphone over USB without echoing the password.

Run after the laptop joins the TP-Link Wi-Fi and local-center is listening on
its LAN IP. Credentials and the center token go over USB only, never stdout.
"""
import argparse
import getpass
import os
from pathlib import Path
import select
import subprocess
import termios
import time
import tty


ROOT = Path(__file__).resolve().parents[2]


def lan_ip(interface):
    return subprocess.check_output(['ipconfig', 'getifaddr', interface], text=True).strip()


def serial_port(path):
    fd = os.open(path, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
    tty.setraw(fd)
    attrs = termios.tcgetattr(fd)
    attrs[4] = termios.B115200
    attrs[5] = termios.B115200
    attrs[2] |= termios.CLOCAL | termios.CREAD
    termios.tcsetattr(fd, termios.TCSANOW, attrs)
    return fd


def lines_until(fd, timeout):
    pending = bytearray()
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        ready, _, _ = select.select([fd], [], [], min(.5, deadline - time.monotonic()))
        if ready:
            try:
                pending.extend(os.read(fd, 4096))
            except BlockingIOError:
                pass
            while b'\n' in pending:
                line, _, rest = pending.partition(b'\n')
                pending = bytearray(rest)
                yield line.decode('ascii', 'replace').strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', default='/dev/cu.usbserial-130')
    parser.add_argument('--interface', default='en0')
    parser.add_argument('--ssid', help='SSID del TP-Link; se pide si falta')
    parser.add_argument('--host', help='IP LAN de la laptop; por defecto se detecta')
    parser.add_argument('--node', default='DEMO-ESP32-WIFI')
    parser.add_argument('--test', action='store_true', help='Grabar y enviar un WAV de prueba')
    parser.add_argument('--auto', action='store_true', help='Activar envíos cada 5 s, persistente tras reinicio')
    args = parser.parse_args()
    host = args.host or lan_ip(args.interface)
    ssid = args.ssid or input('SSID del TP-Link: ').strip()
    password = getpass.getpass('Contraseña Wi-Fi (no se muestra): ')
    token = (ROOT / 'local-center/data/.token').read_text().strip()
    values = (ssid, password, host, token, args.node)
    if not ssid or not host or not token or any('\n' in value or '\t' in value for value in values):
        raise SystemExit('Configuración inválida: campos vacíos o tabuladores/saltos de línea')
    fd = serial_port(args.port)
    try:
        os.write(fd, b'S')
        ready = False
        for line in lines_until(fd, 8):
            if 'MIC_WIFI_READY' in line or line.startswith('STATUS wifi='):
                ready = True
                break
        if not ready:
            raise SystemExit('El ESP32 no respondió con el firmware mic_wifi')
        os.write(fd, ('C\t' + '\t'.join(values) + '\n').encode())
        saved = connected = False
        for line in lines_until(fd, 18):
            if line.startswith(('CONFIG_', 'WIFI_', 'MIC_WIFI_ERROR')):
                print(line)
            if line == 'CONFIG_SAVED':
                saved = True
            if line.startswith('WIFI_CONNECTED'):
                connected = True
                break
        if not saved or not connected:
            raise SystemExit('No se confirmó la conexión Wi-Fi; revisa SSID, clave y señal')
        print(f'Centro esperado: http://{host}:8765; nodo: {args.node}')
        if args.test:
            os.write(fd, b'W')
            for line in lines_until(fd, 25):
                if line.startswith(('UPLOAD_OK', 'UPLOAD_ERROR', 'CAPTURE_ERROR')):
                    print(line)
                    if line != 'UPLOAD_OK status=200':
                        raise SystemExit('Falló la prueba de envío')
                    break
            else:
                raise SystemExit('No llegó respuesta a la captura de prueba')
        if args.auto:
            os.write(fd, b'E')
            for line in lines_until(fd, 3):
                if line.startswith('AUTO_'):
                    print(line)
                    break
    finally:
        os.close(fd)


if __name__ == '__main__':
    main()
