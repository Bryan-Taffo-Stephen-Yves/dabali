"""Tests du module vision (sans modèle ni caméra) :  python -m pytest vision/ -q"""
import re
from pathlib import Path

import numpy as np

from occupancy import OCCUPY_AFTER_S, FREE_AFTER_S, Room, Table, assign


def room():
    return Room(tables=[Table("T1", np.array([[0, 0], [100, 0], [100, 100], [0, 100]], np.int32)),
                        Table("T2", np.array([[200, 0], [300, 0], [300, 100], [200, 100]], np.int32))],
                frame_size=(400, 200))


def test_table_occupee_apres_30s_seulement():
    r = room()
    box = [(40, 10, 60, 50)]  # pieds en (50, 50) → T1
    assign(r, box, (1, 1), 0)
    assign(r, box, (1, 1), OCCUPY_AFTER_S - 1)
    assert not r.tables[0].occupied, "un passage de moins de 30 s n'occupe pas la table"
    assign(r, box, (1, 1), OCCUPY_AFTER_S + 1)
    assert r.tables[0].occupied and not r.tables[1].occupied


def test_table_liberee_apres_60s_sans_personne():
    r = room()
    for t in (0, 40):
        assign(r, [(40, 10, 60, 50)], (1, 1), t)
    assert r.tables[0].occupied
    assign(r, [], (1, 1), 50)
    assign(r, [], (1, 1), 50 + FREE_AFTER_S - 1)
    assert r.tables[0].occupied, "absence courte : la table reste occupée (anti-clignotement)"
    assign(r, [(40, 10, 60, 50)], (1, 1), 50 + FREE_AFTER_S + 5)  # retour : le compteur d'absence repart
    assign(r, [], (1, 1), 200)
    assign(r, [], (1, 1), 200 + FREE_AFTER_S + 1)
    assert not r.tables[0].occupied


def test_snapshot_et_mise_a_l_echelle():
    r = room()
    # image deux fois plus petite que la calibration : la boîte doit être remise à l'échelle
    for t in (0, 31):
        assign(r, [(120, 5, 130, 25), (10, 5, 20, 25)], (2, 2), t)
    s = r.snapshot()
    assert s == {"occupied_tables": 2, "total_tables": 2, "rate": 100.0, "people_count": 2,
                 "table_states": {"T1": True, "T2": True}}


def test_aucune_image_ecrite_ni_envoyee():
    src = (Path(__file__).parent / "occupancy.py").read_text(encoding="utf-8") + \
          (Path(__file__).parent / "calibrate.py").read_text(encoding="utf-8")
    code = "\n".join(l for l in src.splitlines() if not l.strip().startswith("#"))
    code = re.sub(r'""".*?"""', "", code, flags=re.S)
    for forbidden in ("imwrite", "VideoWriter", "imencode", "files=", ".save("):
        assert forbidden not in code, f"{forbidden} interdit dans le module vision"
