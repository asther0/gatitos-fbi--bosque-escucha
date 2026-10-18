#!/usr/bin/env python3
"""Capture one JPEG from camera_test.ino over a macOS/Linux serial port."""
import argparse
import os
import select
import termios
import time
import tty


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", default="/dev/cu.usbserial-A5069RR4")
    parser.add_argument("--out", default="/tmp/esp32cam-capture.jpg")
    args = parser.parse_args()

    fd = os.open(args.port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
    try:
        tty.setraw(fd)
        attrs = termios.tcgetattr(fd)
        attrs[4] = termios.B115200
        attrs[5] = termios.B115200
        attrs[2] |= termios.CLOCAL | termios.CREAD
        attrs[6][termios.VMIN] = 0
        attrs[6][termios.VTIME] = 5
        termios.tcsetattr(fd, termios.TCSANOW, attrs)

        pending = bytearray()

        def line_until(deadline):
            while time.monotonic() < deadline:
                newline = pending.find(b"\n")
                if newline >= 0:
                    line = bytes(pending[:newline]).rstrip(b"\r")
                    del pending[: newline + 1]
                    return line.decode("ascii", "replace")
                ready, _, _ = select.select(
                    [fd], [], [], min(0.5, max(0, deadline - time.monotonic()))
                )
                if ready:
                    try:
                        pending.extend(os.read(fd, 65536))
                    except BlockingIOError:
                        pass
            return None

        print("Solicitando captura serial...")
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            line = line_until(deadline)
            if line is None:
                break
            if line:
                print(line)
            if line.startswith("CAMERA_INIT_FAILED"):
                raise RuntimeError("El sensor no inicializó")

        os.write(fd, b"C")
        header = None
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            line = line_until(deadline)
            if line is None:
                break
            if line:
                print(line)
            if line.startswith("CAMERA_INIT_FAILED"):
                raise RuntimeError("El sensor no inicializó")
            if line.startswith("FRAME:"):
                header = line
                break
        if header is None:
            raise RuntimeError("No llegó una cabecera JPEG después de enviar C")

        size = int(header.split(":", 1)[1])
        deadline = time.monotonic() + 20
        while len(pending) < size and time.monotonic() < deadline:
            ready, _, _ = select.select([fd], [], [], 1)
            if ready:
                try:
                    pending.extend(os.read(fd, 65536))
                except BlockingIOError:
                    pass
        if len(pending) < size:
            raise RuntimeError(f"Foto incompleta: {len(pending)}/{size} bytes")

        jpeg = bytes(pending[:size])
        if jpeg[:2] != b"\xff\xd8" or jpeg[-2:] != b"\xff\xd9":
            raise RuntimeError("La respuesta no tiene marcadores JPEG válidos")
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        with open(args.out, "wb") as image:
            image.write(jpeg)
        print(f"JPEG válido ({size} bytes): {args.out}")
    finally:
        os.close(fd)


if __name__ == "__main__":
    main()
