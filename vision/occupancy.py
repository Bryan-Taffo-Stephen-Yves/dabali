"""
Dabali — module vision : taux d'occupation des tables et longueur de la file d'attente du réfectoire (§7).

Source vidéo : webcam, vidéo, ou téléphone posé dans un angle avec l'appli « IP Webcam » (Android) :
  python occupancy.py --source http://192.168.1.20:8080/video
Zones (tables, file d'attente, comptoir) dessinées avec calibrate.py.

  python occupancy.py                  # tourne en continu, envoie les chiffres à Supabase
  python occupancy.py --preview        # + fenêtre de démo (boîtes et zones colorées)
  python occupancy.py --dry-run        # n'envoie rien (affiche les chiffres)

Vie privée (vérifiable dans ce fichier) :
  - classe « person » uniquement, aucune reconnaissance faciale ;
  - AUCUNE image n'est écrite sur disque ni envoyée : il n'y a ni cv2.imwrite, ni VideoWriter,
    ni upload d'image ; seuls des nombres partent vers Supabase (occupancy_snapshots).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np
import requests
from dotenv import load_dotenv

HERE = Path(__file__).parent
load_dotenv(HERE / ".env")

FRAME_EVERY_S = 2.0     # 1 image analysée toutes les 2 s
SEND_EVERY_S = 10.0     # 1 relevé envoyé toutes les 10 s
OCCUPY_AFTER_S = 30.0   # table occupée après 30 s de présence continue
FREE_AFTER_S = 60.0     # libérée après 60 s sans personne (anti-clignotement)
CONF = 0.35
QUEUE_SMOOTH = 5        # file d'attente : médiane des 5 dernières images (~10 s) contre les passages ponctuels


@dataclass
class Table:
    id: str
    polygon: np.ndarray
    occupied: bool = False
    present_since: float | None = None
    absent_since: float | None = None
    people: int = 0

    def update(self, people_in_zone: int, now: float) -> None:
        """Lissage temporel : évite qu'une table clignote quand quelqu'un passe devant."""
        self.people = people_in_zone
        if people_in_zone > 0:
            self.absent_since = None
            if self.present_since is None:
                self.present_since = now
            if not self.occupied and now - self.present_since >= OCCUPY_AFTER_S:
                self.occupied = True
        else:
            self.present_since = None
            if self.absent_since is None:
                self.absent_since = now
            if self.occupied and now - self.absent_since >= FREE_AFTER_S:
                self.occupied = False


@dataclass
class Room:
    tables: list[Table]
    frame_size: tuple[int, int]
    queue: list[np.ndarray] = field(default_factory=list)     # zones « file d'attente » (couloir)
    counter: list[np.ndarray] = field(default_factory=list)   # zones « comptoir »
    people_count: int = 0
    queue_count: int | None = None
    counter_count: int = 0
    queue_history: deque = field(default_factory=lambda: deque(maxlen=QUEUE_SMOOTH))
    last_boxes: list[tuple[int, int, int, int]] = field(default_factory=list)

    @classmethod
    def load(cls, path: Path) -> "Room":
        cfg = json.loads(path.read_text(encoding="utf-8"))
        poly = lambda z: np.array(z["polygon"], dtype=np.int32)
        return cls(
            tables=[Table(t["id"], poly(t)) for t in cfg.get("tables", [])],
            frame_size=tuple(cfg.get("frame_size", (1280, 720))),
            queue=[poly(z) for z in cfg.get("queue", [])],
            counter=[poly(z) for z in cfg.get("counter", [])],
        )

    def snapshot(self) -> dict:
        occupied = sum(t.occupied for t in self.tables)
        total = len(self.tables)
        snap = {
            "occupied_tables": occupied,
            "total_tables": total,
            "rate": round(100 * occupied / total, 2) if total else 0,
            "people_count": self.people_count,
            "table_states": {t.id: t.occupied for t in self.tables},
        }
        if self.queue:  # seulement si une file d'attente a été délimitée
            snap["queue_count"] = self.queue_count or 0
            snap["counter_count"] = self.counter_count
        return snap


def detect_people(model, frame: np.ndarray) -> list[tuple[int, int, int, int]]:
    res = model.predict(frame, classes=[0], conf=CONF, verbose=False)[0]  # classe 0 = person
    return [tuple(map(int, b)) for b in res.boxes.xyxy.cpu().numpy()]


def assign(room: Room, boxes: list[tuple[int, int, int, int]], scale: tuple[float, float], now: float) -> None:
    """Une personne appartient à une table si le point bas-centre de sa boîte (ses pieds / sa chaise) est dans le polygone."""
    sx, sy = scale
    inside = lambda poly, pt: cv2.pointPolygonTest(poly, pt, False) >= 0
    counts = {t.id: 0 for t in room.tables}
    in_queue = at_counter = 0
    for x1, y1, x2, y2 in boxes:
        foot = (float((x1 + x2) / 2 * sx), float(y2 * sy))
        table = next((t for t in room.tables if inside(t.polygon, foot)), None)
        if table:
            counts[table.id] += 1
        elif any(inside(q, foot) for q in room.queue):
            in_queue += 1
        elif any(inside(c, foot) for c in room.counter):
            at_counter += 1
    for t in room.tables:
        t.update(counts[t.id], now)
    room.people_count = len(boxes)
    room.last_boxes = boxes
    if room.queue:
        room.queue_history.append(in_queue)
        room.queue_count = int(np.median(room.queue_history))
        room.counter_count = at_counter


def send(snapshot: dict, room_id: str) -> None:
    url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/occupancy_snapshots"
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    r = requests.post(
        url,
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "return=minimal"},
        data=json.dumps({"room_id": room_id, **snapshot}),
        timeout=8,
    )
    r.raise_for_status()


def draw_preview(frame: np.ndarray, room: Room, scale: tuple[float, float]) -> np.ndarray:
    """Affichage de démo uniquement (fenêtre à l'écran, jamais enregistré)."""
    view = frame.copy()
    inv = (1 / scale[0], 1 / scale[1])
    overlay = view.copy()
    for t in room.tables:
        pts = (t.polygon * np.array(inv)).astype(np.int32)
        color = (68, 68, 239) if t.occupied else (94, 197, 34)  # BGR : rouge occupée / vert libre
        cv2.fillPoly(overlay, [pts], color)
        cv2.polylines(view, [pts], True, color, 2)
        x, y = pts[0]
        cv2.putText(view, f"{t.id}{' *' if t.people else ''}", (int(x) + 6, int(y) + 22), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
    for zones, color, label in ((room.queue, (11, 158, 245), "File"), (room.counter, (246, 130, 59), "Comptoir")):
        for poly in zones:
            pts = (poly * np.array(inv)).astype(np.int32)
            cv2.fillPoly(overlay, [pts], color)
            cv2.polylines(view, [pts], True, color, 2)
            x, y = pts[0]
            cv2.putText(view, label, (int(x) + 6, int(y) + 22), cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
    view = cv2.addWeighted(overlay, 0.25, view, 0.75, 0)
    for x1, y1, x2, y2 in room.last_boxes:
        cv2.rectangle(view, (x1, y1), (x2, y2), (53, 241, 200), 2)  # vert citron
    s = room.snapshot()
    banner = f"Occupation {s['rate']:.0f}%  |  {s['occupied_tables']}/{s['total_tables']} tables  |  {s['people_count']} personnes"
    if "queue_count" in s:
        banner += f"  |  file : {s['queue_count']}"
    cv2.rectangle(view, (0, 0), (view.shape[1], 40), (29, 24, 22), -1)
    cv2.putText(view, banner, (12, 27), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (53, 241, 200), 2)
    cv2.putText(view, "Zone d'analyse de l'affluence - aucune image conservee", (12, view.shape[0] - 14),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1)
    return view


def open_source(src: str) -> cv2.VideoCapture:
    cap = cv2.VideoCapture(int(src) if src.isdigit() else src)
    if not cap.isOpened():
        sys.exit(f"Impossible d'ouvrir la source vidéo : {src}")
    return cap


def main() -> None:
    ap = argparse.ArgumentParser(description="Dabali — affluence par vision (YOLO11n)")
    ap.add_argument("--source", default=os.environ.get("VIDEO_SOURCE", "0"))
    ap.add_argument("--zones", default=str(HERE / "zones.json"))
    ap.add_argument("--model", default="yolo11n.pt")
    ap.add_argument("--preview", action="store_true", help="fenêtre de démo avec boîtes et zones")
    ap.add_argument("--dry-run", action="store_true", help="n'envoie rien à Supabase")
    args = ap.parse_args()

    from ultralytics import YOLO  # import tardif : --help reste instantané

    room = Room.load(Path(args.zones))
    room_id = os.environ.get("ROOM_ID", "")
    if not args.dry_run and not (room_id and os.environ.get("SUPABASE_SERVICE_ROLE_KEY")):
        sys.exit("ROOM_ID et SUPABASE_SERVICE_ROLE_KEY requis (ou --dry-run). Voir vision/.env.example")

    model = YOLO(args.model)
    cap = open_source(args.source)
    is_file = Path(args.source).is_file()
    last_frame = last_send = 0.0
    print(f"Analyse de {len(room.tables)} tables, {len(room.queue)} zone(s) de file · 1 image / {FRAME_EVERY_S:.0f} s · envoi / {SEND_EVERY_S:.0f} s")

    while True:
        ok, frame = cap.read()
        if not ok:
            if is_file:  # démo : la vidéo enregistrée tourne en boucle
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                continue
            time.sleep(1)
            cap = open_source(args.source)
            continue

        now = time.monotonic()
        if now - last_frame >= FRAME_EVERY_S:
            last_frame = now
            h, w = frame.shape[:2]
            scale = (room.frame_size[0] / w, room.frame_size[1] / h)
            assign(room, detect_people(model, frame), scale, now)

            if now - last_send >= SEND_EVERY_S:
                last_send = now
                snap = room.snapshot()
                if args.dry_run:
                    print(json.dumps(snap))
                else:
                    try:
                        send(snap, room_id)
                        queue = f", file {snap['queue_count']}" if "queue_count" in snap else ""
                        print(f"{time.strftime('%H:%M:%S')} → {snap['rate']:.0f} % ({snap['occupied_tables']}/{snap['total_tables']}), {snap['people_count']} pers.{queue}")
                    except requests.RequestException as e:
                        print(f"Envoi impossible ({e}) — l'appli se rabat sur l'estimation par les scans.")

        if args.preview:
            h, w = frame.shape[:2]
            cv2.imshow("Dabali - affluence", draw_preview(frame, room, (room.frame_size[0] / w, room.frame_size[1] / h)))
            if cv2.waitKey(1) & 0xFF in (27, ord("q")):
                break
        elif is_file:
            time.sleep(1 / 30)  # lecture d'un fichier à vitesse réelle

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
