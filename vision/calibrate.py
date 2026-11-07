"""
Délimitation des zones du réfectoire sur une capture du flux (téléphone, webcam ou vidéo) :
  - TABLES        : où les gens mangent (une zone par table)          → taux d'occupation
  - FILE D'ATTENTE : le couloir où l'on fait le rang (une ou plusieurs) → longueur de la file, temps d'attente
  - COMPTOIR      : là où l'on prend son plat (facultatif)

  python calibrate.py --source http://192.168.1.20:8080/video   # téléphone avec l'appli « IP Webcam »
  python calibrate.py --source 0                                # webcam
  python calibrate.py --source demo.mp4                         # vidéo de démo

Touches : 1 = tables · 2 = file d'attente · 3 = comptoir
Clic gauche : ajouter un coin · Entrée : fermer la zone · Retour arrière : annuler le dernier coin
Z : supprimer la dernière zone du mode courant · S : enregistrer zones.json · Échap : quitter
Les zones déjà enregistrées sont rechargées pour être corrigées. La capture reste en mémoire (aucune image écrite).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).parent
MODES = {
    "tables": {"key": ord("1"), "label": "TABLES", "color": (94, 197, 34), "prefix": "T"},
    "queue": {"key": ord("2"), "label": "FILE D'ATTENTE", "color": (11, 158, 245), "prefix": "F"},
    "counter": {"key": ord("3"), "label": "COMPTOIR", "color": (246, 130, 59), "prefix": "C"},
}


def load_zones(path: Path) -> dict[str, list[dict]]:
    zones: dict[str, list[dict]] = {"tables": [], "queue": [], "counter": []}
    if path.exists():
        cfg = json.loads(path.read_text(encoding="utf-8"))
        for k in zones:
            zones[k] = list(cfg.get(k, []))
    return zones


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

    out = Path(args.out)
    zones = load_zones(out)
    mode = "tables"
    current: list[list[int]] = []

    def on_click(event, x, y, *_):
        if event == cv2.EVENT_LBUTTONDOWN:
            current.append([x, y])

    cv2.namedWindow("Calibration Dabali")
    cv2.setMouseCallback("Calibration Dabali", on_click)
    while True:
        view = frame.copy()
        overlay = view.copy()
        for k, items in zones.items():
            color = MODES[k]["color"]
            for z in items:
                pts = np.array(z["polygon"], np.int32)
                cv2.fillPoly(overlay, [pts], color)
                cv2.polylines(view, [pts], True, color, 2)
                cv2.putText(view, z["id"], tuple(pts[0] + [6, 22]), cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
        view = cv2.addWeighted(overlay, 0.2, view, 0.8, 0)
        if current:
            c = MODES[mode]["color"]
            cv2.polylines(view, [np.array(current, np.int32)], False, c, 2)
            for p in current:
                cv2.circle(view, tuple(p), 4, c, -1)
        cv2.rectangle(view, (0, 0), (w, 62), (29, 24, 22), -1)
        cv2.putText(view, f"Mode {MODES[mode]['label']} : cliquez les coins, Entree pour fermer la zone",
                    (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, MODES[mode]["color"], 2)
        cv2.putText(view, f"1 tables ({len(zones['tables'])})  2 file ({len(zones['queue'])})  3 comptoir ({len(zones['counter'])})"
                          "   Z suppr.  S enregistrer  Echap quitter", (10, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
        cv2.imshow("Calibration Dabali", view)

        k = cv2.waitKey(20) & 0xFF
        for name, m in MODES.items():
            if k == m["key"]:
                mode, current = name, []
        if k == 13 and len(current) >= 3:
            n = len(zones[mode]) + 1
            zones[mode].append({"id": f"{MODES[mode]['prefix']}{n}", "polygon": current.copy()})
            current.clear()
        elif k == 8 and current:
            current.pop()
        elif k in (ord("z"), ord("Z")) and zones[mode]:
            zones[mode].pop()
        elif k in (ord("s"), ord("S")):
            out.write_text(json.dumps({"frame_size": [w, h], **zones}, indent=2), encoding="utf-8")
            print(f"Enregistré dans {out} : {len(zones['tables'])} tables, {len(zones['queue'])} zone(s) de file, "
                  f"{len(zones['counter'])} comptoir(s)")
        elif k == 27:
            break
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
