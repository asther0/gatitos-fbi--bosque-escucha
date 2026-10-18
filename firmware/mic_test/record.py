#!/usr/bin/env python3
"""Graba dos segundos del INMP441 en un WAV usando solo la biblioteca estándar."""
import argparse
import array
import os
import select
import sys
import termios
import time
import tty
import wave


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", default="/dev/cu.usbserial-130")
    parser.add_argument("--out", default=".local/microfono-prueba.wav")
    parser.add_argument("--no-countdown", action="store_true", help="Iniciar captura sin cuenta regresiva")
    args = parser.parse_args()

    fd = os.open(args.port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
    pending = bytearray()
    try:
        tty.setraw(fd)
        attrs = termios.tcgetattr(fd)
        attrs[4] = termios.B115200
        attrs[5] = termios.B115200
        attrs[2] |= termios.CLOCAL | termios.CREAD
        attrs[6][termios.VMIN] = 0
        attrs[6][termios.VTIME] = 5
        termios.tcsetattr(fd, termios.TCSANOW, attrs)

        def receive(deadline):
            ready, _, _ = select.select([fd], [], [], min(0.5, max(0, deadline - time.monotonic())))
            if ready:
                try:
                    pending.extend(os.read(fd, 65536))
                except BlockingIOError:
                    pass

        def read_line(deadline):
            while time.monotonic() < deadline:
                end = pending.find(b"\n")
                if end >= 0:
                    line = bytes(pending[:end]).rstrip(b"\r")
                    del pending[:end + 1]
                    return line.decode("ascii", "replace")
                receive(deadline)
            raise TimeoutError("No llegó respuesta del ESP32")

        # Opening the serial port may reset the board. Also request status from
        # the Wi-Fi firmware, which has no continuous diagnostic output.
        os.write(fd, b"S")
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            line = read_line(deadline)
            if "I2S_READY" in line or "samples=" in line or line.startswith("STATUS wifi="):
                break
        if not args.no_countdown:
            print("Habla cerca del micrófono: 'Bosque Escucha, uno, dos, tres'.")
            for n in (3, 2, 1):
                print(n, flush=True)
                time.sleep(1)
        # Discard old level-meter lines; next record starts on the R command.
        termios.tcflush(fd, termios.TCIFLUSH)
        pending.clear()
        os.write(fd, b"R")
        print("Grabando 2 segundos...", flush=True)
        deadline = time.monotonic() + 10
        while True:
            line = read_line(deadline)
            if line.startswith("MIC_CAPTURE_ERROR"):
                raise RuntimeError(line)
            if line.startswith("MIC_CAPTURE_BEGIN"):
                parts = dict(item.split("=", 1) for item in line.split()[1:])
                size = int(parts["bytes"])
                rate = int(parts["rate"])
                break
        deadline = time.monotonic() + max(30, size / 8000)
        while len(pending) < size and time.monotonic() < deadline:
            receive(deadline)
        if len(pending) < size:
            raise TimeoutError(f"Audio incompleto: {len(pending)}/{size} bytes")
        pcm = bytes(pending[:size])
        samples = array.array("h")
        samples.frombytes(pcm)
        if sys.byteorder != "little":
            samples.byteswap()
        # The INMP441 is quiet in a 16-bit WAV. Raise speech level for playback.
        level = sorted(abs(v) for v in samples)[int(len(samples) * 0.995)]
        gain = min(100.0, 12000.0 / max(level, 1))
        for i, value in enumerate(samples):
            samples[i] = max(-32768, min(32767, round(value * gain)))
        if sys.byteorder != "little":
            samples.byteswap()
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        with wave.open(args.out, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(rate)
            wav.writeframes(samples.tobytes())
        print(f"Grabación lista: {args.out} ({size / (rate * 2):.1f} s, volumen ajustado)")
    finally:
        os.close(fd)


if __name__ == "__main__":
    main()
