#!/usr/bin/env python3
"""
Generate the PWA icons.

Same rubber-stamp motif as the confidence rank and the 1ST/2ND seals:
a dashed outer ring, a solid inner ring, a heavy letter. Drawn at 4x and
downsampled so the ring edges stay clean at 192px.

    python scripts/make_icons.py

Writes icons/icon-192.png, icon-512.png, icon-maskable-512.png,
plus favicon.png.
"""

import math, pathlib, sys
from PIL import Image, ImageDraw, ImageFont

SHELL = (26, 25, 23)        # --shell
STAMP = (200, 52, 42)       # --stamp
PAPER = (250, 247, 241)     # --paper

FONT = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
SS = 4                      # supersample


def dashed_ring(d, box, color, width, dashes=44, gap_ratio=0.42):
    """A ring of short arcs — the serrated edge of a rubber stamp."""
    step = 360 / dashes
    on = step * (1 - gap_ratio)
    for i in range(dashes):
        a = i * step
        d.arc(box, a, a + on, fill=color, width=width)


def build(px, maskable=False):
    S = px * SS
    img = Image.new("RGB", (S, S), SHELL)
    d = ImageDraw.Draw(img)

    # Maskable icons get cropped to a circle on Android, so the artwork
    # has to sit inside the middle 80%.
    scale = 0.62 if maskable else 0.76
    r = S * scale / 2
    cx = cy = S / 2
    box = [cx - r, cy - r, cx + r, cy + r]

    dashed_ring(d, box, STAMP, int(S * 0.026))
    inner = r * 0.76
    d.ellipse([cx - inner, cy - inner, cx + inner, cy + inner],
              outline=STAMP, width=int(S * 0.016))

    # The letter, optically centred rather than box-centred.
    size = int(inner * 1.35)
    f = ImageFont.truetype(FONT, size)
    tb = d.textbbox((0, 0), "P", font=f)
    w, h = tb[2] - tb[0], tb[3] - tb[1]
    d.text((cx - w / 2 - tb[0], cy - h / 2 - tb[1] - S * 0.012),
           "P", font=f, fill=PAPER)

    return img.resize((px, px), Image.LANCZOS)


def main():
    out = pathlib.Path(__file__).resolve().parent.parent / "icons"
    out.mkdir(exist_ok=True)
    jobs = [("icon-192.png", 192, False),
            ("icon-512.png", 512, False),
            ("icon-maskable-512.png", 512, True),
            ("favicon.png", 64, False)]
    for name, px, mask in jobs:
        build(px, mask).save(out / name, "PNG", optimize=True)
        print(f"  {name:<26}{px}x{px}{'  (safe area)' if mask else ''}")
    print(f"\nWritten to {out}")


if __name__ == "__main__":
    sys.exit(main())
