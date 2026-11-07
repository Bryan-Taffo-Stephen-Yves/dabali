"""
Calibration des zones-tables : cliquez les coins de chaque table sur une capture du flux.

  python calibrate.py --source 0            # webcam
  python calibrate.py --source demo.mp4     # vidéo de démo

Clic gauche : ajouter un point · Entrée : valider la table · Retour arrière : annuler le dernier point
S : enregistrer zones.json · Échap : quitter
La capture reste en mémoire (aucune image écrite sur disque).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).parent


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="0")
    ap.add_argument("--out", default=str(HERE / "zones.json"))
    args = ap.parse_args()

    cap = cv2.VideoCapture(int(args.source) if args.source.isdigit() else args.source)
    ok, frame = cap.read()
    cap.release()
    if not ok:
        raise SystemExit("Impossible de lire une image de la source.")
    h, w = frame.shape[:2]

    tables: list[dict] = []
    current: list[list[int]] = []

    def on_click(event, x, y, *_):
        if event == cv2.EVENT_LBUTTONDOWN:
            current.append([x, y])

    cv2.namedWindow("Calibration Dabali")
    cv2.setMouseCallback("Calibration Dabali", on_click)
    while True:
        view = frame.copy()
        for t in tables:
            pts = np.array(t["polygon"], np.int32)
            cv2.polylines(view, [pts], True, (94, 197, 34), 2)
            cv2.putText(view, t["id"], tuple(pts[0] + [6, 22]), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (94, 197, 34), 2)
        if current:
            cv2.polylines(view, [np.array(current, np.int32)], False, (53, 241, 200), 2)
            for p in current:
                cv2.circle(view, tuple(p), 4, (53, 241, 200), -1)
        cv2.putText(view, f"Table T{len(tables) + 1} : cliquez les coins, Entree pour valider, S pour enregistrer",
                    (10, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        cv2.imshow("Calibration Dabali", view)
        k = cv2.waitKey(20) & 0xFF
        if k == 13 and len(current) >= 3:
            tables.append({"id": f"T{len(tables) + 1}", "polygon": current.copy()})
            current.clear()
        elif k == 8 and current:
            current.pop()
        elif k in (ord("s"), ord("S")):
            Path(args.out).write_text(json.dumps({"frame_size": [w, h], "tables": tables}, indent=2), encoding="utf-8")
            print(f"{len(tables)} tables enregistrées dans {args.out}")
        elif k == 27:
            break
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
