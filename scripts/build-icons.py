"""Rebuild desktop icons from the original team image (requires Pillow).

Use a silhouette mask, not a blue-colour key: blue is part of Panama's flag.
Run from any directory with: python scripts/build-icons.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
source = Image.open(root / "public/panama-accuracy-flag.png").convert("RGBA")
# Trace the outside of the face, including its lower-left blue flag quadrant.
outline = [
    (38, 78), (45, 69), (53, 55), (62, 38), (74, 23), (88, 15),
    (111, 13), (143, 14), (174, 17), (203, 23), (229, 34),
    (247, 50), (259, 69), (265, 86), (264, 102), (258, 115),
    (253, 124), (253, 153), (254, 179), (253, 201), (248, 213),
    (237, 221), (220, 224), (200, 224), (180, 220), (157, 213),
    (134, 204), (111, 194), (90, 181), (73, 165), (61, 149),
    (52, 130), (48, 117), (41, 110), (37, 98), (36, 88),
]
scale = 4
mask = Image.new("L", (source.width * scale, source.height * scale))
ImageDraw.Draw(mask).polygon([(x * scale, y * scale) for x, y in outline], fill=255)
source.putalpha(mask.resize(source.size, Image.Resampling.LANCZOS))
face = source.crop((34, 11, 267, 226))
face.thumbnail((448, 448), Image.Resampling.LANCZOS)
# Enlarge as well as shrink the small original artwork.
ratio = min(448 / face.width, 448 / face.height)
face = face.resize((round(face.width * ratio), round(face.height * ratio)), Image.Resampling.LANCZOS)
icon = Image.new("RGBA", (512, 512))
icon.alpha_composite(face, ((512 - face.width) // 2, (512 - face.height) // 2))
# Regression check: the flag quadrant must remain opaque and blue.
blue_pixels = sum(1 for r, g, b, a in icon.crop((70, 260, 230, 390)).getdata()
                  if a > 240 and b > r * 1.4 and b > g * 1.1)
assert blue_pixels > 1000, "The blue flag quadrant was lost"
target = root / "build/icons"
target.mkdir(parents=True, exist_ok=True)
icon.save(target / "icon.png")
icon.save(target / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print(f"Regenerated PNG and Windows ICO; {blue_pixels} opaque blue quadrant pixels")
