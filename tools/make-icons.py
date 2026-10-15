"""Draws the app icons (a work/rest ring) as PNGs. No dependencies.

Run from the project root:  python3 tools/make-icons.py
"""
import math
import struct
import zlib
from pathlib import Path

BG = (15, 17, 21)
WORK = (34, 180, 98)
REST = (245, 158, 11)
CENTER = (242, 243, 245)

WORK_SHARE = 0.6        # fraction of the ring that is green
RING = (0.25, 0.36)     # inner/outer radius, in icon widths
GAP = 0.035             # gap between the arcs, in radians-ish of unit circle
SAMPLES = 3             # supersampling per axis, for anti-aliasing


def shade(x, y, scale, rounded):
    """Colour at (x, y) in 0..1 icon space, or None for transparent."""
    if rounded:
        r = 0.2  # corner radius of the rounded square
        dx = max(r - x, 0, x - (1 - r))
        dy = max(r - y, 0, y - (1 - r))
        if dx * dx + dy * dy > r * r:
            return None
    cx, cy = (x - 0.5) / scale, (y - 0.5) / scale
    dist = math.hypot(cx, cy)
    if RING[0] <= dist <= RING[1]:
        turn = (math.atan2(cx, -cy) / (2 * math.pi)) % 1  # 0 at 12 o'clock, clockwise
        split = WORK_SHARE
        if min(turn, 1 - turn, abs(turn - split)) < GAP / (2 * math.pi) * 1.5:
            return BG
        return WORK if turn < split else REST
    if dist <= 0.07:
        return CENTER
    return BG


def render(size, scale=1.0, rounded=False):
    rows = []
    n = SAMPLES
    for py in range(size):
        row = bytearray([0])  # PNG filter type: none
        for px in range(size):
            r = g = b = a = 0
            for sy in range(n):
                for sx in range(n):
                    c = shade((px + (sx + 0.5) / n) / size, (py + (sy + 0.5) / n) / size, scale, rounded)
                    if c:
                        r += c[0]; g += c[1]; b += c[2]; a += 1
            if a:
                row += bytes((r // a, g // a, b // a, 255 * a // (n * n)))
            else:
                row += bytes(4)
        rows.append(bytes(row))
    return png(size, b"".join(rows))


def png(size, raw):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def main():
    out = Path("icons")
    out.mkdir(exist_ok=True)
    # "any" icons: rounded square with transparent corners.
    (out / "icon-192.png").write_bytes(render(192, rounded=True))
    (out / "icon-512.png").write_bytes(render(512, rounded=True))
    # Maskable: full bleed, artwork shrunk into the safe zone (Android crops it to a circle etc.).
    (out / "icon-maskable-512.png").write_bytes(render(512, scale=0.8))
    # iOS rounds the corners itself and dislikes transparency.
    (out / "apple-touch-icon.png").write_bytes(render(180))


if __name__ == "__main__":
    main()
