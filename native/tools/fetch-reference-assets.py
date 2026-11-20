"""Optional development fixtures; the Rust app never fetches these at runtime."""
from pathlib import Path
from urllib.request import Request, urlopen

destination = Path(__file__).resolve().parents[1] / "demo-covers"
destination.mkdir(exist_ok=True)
assets = {
    **{f"{identifier}.jpg": f"https://assets.ppy.sh/beatmaps/{identifier}/covers/cover.jpg"
       for identifier in (63834, 39804, 320118)},
    "DM-Sans.ttf": "https://raw.githubusercontent.com/google/fonts/main/ofl/dmsans/DMSans%5Bopsz,wght%5D.ttf",
    "DM-Sans-OFL.txt": "https://raw.githubusercontent.com/google/fonts/main/ofl/dmsans/OFL.txt",
    "Outfit.ttf": "https://raw.githubusercontent.com/google/fonts/main/ofl/outfit/Outfit%5Bwght%5D.ttf",
    "Outfit-OFL.txt": "https://raw.githubusercontent.com/google/fonts/main/ofl/outfit/OFL.txt",
}
for name, url in assets.items():
    with urlopen(Request(url, headers={"User-Agent": "PACC-BD-Rust-visual-prototype"}), timeout=30) as response:
        content = response.read(5 * 1024 * 1024 + 1)
    if not content or len(content) > 5 * 1024 * 1024:
        raise ValueError(f"Unexpected asset size: {name}")
    (destination / name).write_bytes(content)
    print(f"Saved {name}")
