"""Prépare les photos des plats pour le web : recadrage 4:3 au centre, 720×540 max, JPEG progressif qualité 74.

  python scripts/optimize-photos.py public/dishes/nouveau-plat.jpg   # un fichier
  python scripts/optimize-photos.py                                  # tout public/dishes/

Les cartes affichent les photos en paysage (object-cover), donc le recadrage ne coupe rien de visible.
Cible : moins de 100 Ko par photo.
"""
import glob, sys
from PIL import Image, ImageOps

files = sys.argv[1:] or sorted(glob.glob("public/dishes/*.jpg"))
for f in files:
    im = ImageOps.exif_transpose(Image.open(f)).convert("RGB")
    w = min(720, im.width, round(im.height * 4 / 3))
    im = ImageOps.fit(im, (w, round(w * 3 / 4)), Image.LANCZOS)
    im.save(f, "JPEG", quality=74, optimize=True, progressive=True)
    print(f, im.size)
