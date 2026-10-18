"""Capture the attached ESP32 microphone, classify it with YAMNet, optionally ingest it."""
import argparse
import subprocess
import sys
import time
from pathlib import Path

import httpx
import numpy as np
import soundfile as sf

from models import AudioDetector

ROOT = Path(__file__).resolve().parent.parent
CENTER = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", default="/dev/cu.usbserial-130")
    parser.add_argument("--out", type=Path, default=ROOT / ".local/ultima-captura.wav")
    parser.add_argument("--file", type=Path, help="Clasificar un WAV existente sin grabar del ESP32")
    parser.add_argument("--node", default="DEMO-ESP32-MIC")
    parser.add_argument("--count", type=int, default=1, help="Número de capturas; 0 = continuo")
    parser.add_argument("--send", action="store_true", help="Enviar WAV a /api/raw del centro local")
    parser.add_argument("--url", default="http://127.0.0.1:8765")
    args = parser.parse_args()
    if args.count < 0:
        parser.error("--count debe ser 0 o mayor")
    if args.file and args.count != 1:
        parser.error("--file solo admite una clasificación")
    detector = AudioDetector(CENTER / "models/yamnet", CENTER / "models/yamnet-source/yamnet_class_map.csv")
    print("YAMNet listo." + ("" if args.file else " Una captura dura 2 segundos; el traspaso por USB tarda unos segundos más."), flush=True)
    attempt = 0
    try:
        while args.count == 0 or attempt < args.count:
            attempt += 1
            capture_file = args.file or args.out
            if not args.file:
                subprocess.run(
                    [sys.executable, str(ROOT / "firmware/mic_test/record.py"),
                     "--port", args.port, "--out", str(args.out), "--no-countdown"],
                    cwd=ROOT, check=True,
                )
            wave, rate = sf.read(capture_file, dtype="float32")
            if rate != 16000 or wave.ndim != 1:
                raise RuntimeError("El WAV capturado no es mono a 16 kHz")
            scores, _, _ = detector.model(wave)
            peak = np.max(scores.numpy(), axis=0)
            top = np.argsort(peak)[-3:][::-1]
            print("Sonidos: " + ", ".join(f"{detector.names[int(i)]} {float(peak[i]):.2f}" for i in top))
            print(f"Chainsaw: {float(peak[detector.names.index('Chainsaw')]):.3f} · Walk, footsteps: {float(peak[detector.names.index('Walk, footsteps')]):.3f}")
            detector.history.clear()
            detections = detector.predict(capture_file)
            chainsaw = next((d for d in detections if d["event_type"] == "chainsaw" and d["persistent"]), None)
            print("Resultado: " + (f"MOTOSIERRA persistente ({chainsaw['confidence']:.2f})" if chainsaw else "sin alerta de motosierra"), flush=True)
            if args.send:
                token = (CENTER / "data/.token").read_text().strip()
                with capture_file.open("rb") as wav, httpx.Client(timeout=30) as client:
                    response = client.post(
                        args.url.rstrip("/") + "/api/raw",
                        headers={"Authorization": "Bearer " + token},
                        files={"file": (capture_file.name, wav, "audio/wav")},
                        data={"node_id": args.node},
                    )
                    response.raise_for_status()
                    capture = response.json()
                    print(f"Centro local: captura {capture['id']} · {capture['analysis_status']}", flush=True)
                    for _ in range(20):
                        if capture["analysis_status"] != "queued":
                            break
                        time.sleep(1)
                        dashboard = client.get(args.url.rstrip("/") + "/api/dashboard", headers={"Authorization": "Bearer " + token})
                        dashboard.raise_for_status()
                        capture = next(c for c in dashboard.json()["captures"] if c["id"] == capture["id"])
                    print(f"Análisis del centro: {capture['analysis_status']} · detecciones: {capture.get('detections')}", flush=True)
                    if capture.get("analysis_error"):
                        print(f"Error: {capture['analysis_error']}", flush=True)
    except KeyboardInterrupt:
        print("Captura detenida.")


if __name__ == "__main__":
    main()
