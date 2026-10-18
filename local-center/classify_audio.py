"""Inspect real YAMNet scores for a local WAV without creating an incident."""
import argparse
from pathlib import Path

import numpy as np
import soundfile as sf

from models import AudioDetector


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wav", type=Path)
    parser.add_argument("--model", type=Path, default=Path(__file__).parent / "models/yamnet")
    parser.add_argument("--class-map", type=Path, default=Path(__file__).parent / "models/yamnet-source/yamnet_class_map.csv")
    args = parser.parse_args()
    wave, rate = sf.read(args.wav, dtype="float32")
    if rate != 16000 or wave.ndim != 1:
        parser.error("Se requiere WAV mono a 16 kHz")
    detector = AudioDetector(args.model, args.class_map)
    scores, _, _ = detector.model(wave)
    scores = scores.numpy()
    peak = np.max(scores, axis=0)
    top = np.argsort(peak)[-8:][::-1]
    print(f"Archivo: {args.wav} | duración: {len(wave)/rate:.2f} s | ventanas: {len(scores)}")
    for i in top:
        print(f"  {detector.names[int(i)]}: {float(peak[i]):.3f}")
    for name in ("Chainsaw", "Walk, footsteps", "Speech"):
        print(f"{name}: {float(peak[detector.names.index(name)]):.3f}")
    print(f"Eventos objetivo (umbral 0.65): {detector.predict(args.wav)}")


if __name__ == "__main__":
    main()
