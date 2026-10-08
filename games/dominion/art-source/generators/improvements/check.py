"""usage: python3 -I check.py <svg-dir> <out-dir>"""
import subprocess, sys, tempfile
from pathlib import Path
from PIL import Image

SVG, OUT = Path(sys.argv[1]), Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
tmp = Path(tempfile.mkdtemp())
BG = (38, 42, 50, 255)


def r(rel, z):
    o = tmp / f"{rel.replace('/', '_')}@{z}.png"
    if not o.exists():
        subprocess.run(['rsvg-convert', '-z', str(z), str(SVG / rel), '-o', str(o)], check=True)
    return Image.open(o).convert('RGBA')


def single(z):
    pairs = [('terrain/terrain.plains.default.svg', 72, 'improvements/improvement.farm.default.svg'),
             ('terrain/terrain.plains.default.svg', 40, 'improvements/improvement.lumber_camp.default.svg'),
             ('terrain/terrain.mountain.default.svg', 72, 'improvements/improvement.mine.default.svg')]
    pairs = [(t, 72 if 'mountain' in t else 40, o) for t, _, o in pairs]
    W = 110 * z
    out = Image.new('RGBA', (W * 3, 120 * z), BG)
    for i, (t, ay, o) in enumerate(pairs):
        sx, sy = i * W + 55 * z, 80 * z
        out.alpha_composite(r(t, z), (sx - 48 * z, sy - ay * z))
        out.alpha_composite(r(o, z), (sx - 48 * z, sy - 40 * z))
    out.save(OUT / f'singles@{z}.png')


# 4x4 plains; road graph with orthogonal + diagonal edges
ROADS = [((0, 0), (0, 1)), ((0, 1), (1, 2)), ((1, 2), (2, 2)), ((2, 2), (3, 3)), ((2, 2), (2, 3)),
         ((1, 2), (0, 3)), ((2, 2), (3, 1)), ((3, 1), (3, 0)), ((0, 1), (1, 0)), ((1, 0), (2, 0)), ((2, 2), (2, 1))]
NAME = {(-1, 0): 'n', (-1, 1): 'ne', (0, 1): 'e', (1, 1): 'se', (1, 0): 's', (1, -1): 'sw', (0, -1): 'w', (-1, -1): 'nw'}


def grid(z, overlay_pass=True):
    n = 4
    W = 96 * z
    out = Image.new('RGBA', (W * (n + 1), W * (n + 2) // 2), BG)
    ox, oy = out.width // 2, int(W * 0.6)
    order = sorted(((rr, c) for rr in range(n) for c in range(n)), key=lambda rc: (rc[0] + rc[1], rc[1]))
    pos = lambda rr, c: (ox + (c - rr) * W // 2, oy + (c + rr) * W // 4)
    segs = {}
    for a, b in ROADS:
        for p, q in ((a, b), (b, a)):
            segs.setdefault(p, []).append(NAME[(q[0] - p[0], q[1] - p[1])])
    def put(rel, rr, c):
        sx, sy = pos(rr, c)
        out.alpha_composite(r(rel, z), (sx - 48 * z, sy - 40 * z))
    def overlays(rr, c):
        for d in segs.get((rr, c), []):
            put(f'roads/road.{d}.svg', rr, c)
        if (rr, c) in segs:
            put('roads/road.center.svg', rr, c)
    for rr, c in order:
        put('terrain/terrain.plains.default.svg', rr, c)
        if not overlay_pass:
            overlays(rr, c)
    if overlay_pass:
        for rr, c in order:
            overlays(rr, c)
    out.save(OUT / f'grid{"" if overlay_pass else "-interleaved"}@{z}.png')


for z in (1, 3):
    single(z)
    grid(z)
    grid(z, False)
