"""Rebuild desktop icons from the supplied transparent team PNG (requires Pillow).

Preserve the artwork's existing alpha channel and all flag colours without masking.
Run from any directory with: python scripts/build-icons.py
"""
from pathlib import Path
from PIL import Image, ImageOps

root = Path(__file__).resolve().parents[1]
source = Image.open(root / "public/panama-accuracy-flag.png").convert("RGBA")
face = ImageOps.contain(source, (448, 448), Image.Resampling.LANCZOS)
icon = Image.new("RGBA", (512, 512))
icon.alpha_composite(face, ((512 - face.width) // 2, (512 - face.height) // 2))
# Regression check: the flag quadrant must remain opaque and blue.
quadrant = icon.crop((70, 260, 230, 390))
blue_pixels = sum(1 for r, g, b, a in [quadrant.getpixel((x, y))
                  for y in range(quadrant.height) for x in range(quadrant.width)]
                  if a > 240 and b > r * 1.4 and b > g * 1.1)
assert blue_pixels > 1000, "The blue flag quadrant was lost"
target = root / "build/icons"
target.mkdir(parents=True, exist_ok=True)
icon.save(target / "icon.png")
icon.save(target / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print(f"Regenerated PNG and Windows ICO; {blue_pixels} opaque blue quadrant pixels")
