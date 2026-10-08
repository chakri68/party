"""Compose a sample match board from SVG sources, using the anchors and draw order in svg/STYLE.md.

usage: python3 -I preview_svg_scene.py <svg-dir> <out-dir>

Renders every sprite with rsvg-convert at zoom 1 and 2. Owner groups are tinted per player
(light/mid/dark from data-tone) on a temp copy, the way the engine would.
"""
import re, subprocess, sys, tempfile
from pathlib import Path
from PIL import Image

SVG, OUT = Path(sys.argv[1]), Path(sys.argv[2])
TW = 96

T = {  # terrain key -> variants
    'p': ['terrain.plains.default', 'terrain.plains.v2', 'terrain.plains.v3'],
    'f': ['terrain.forest.default', 'terrain.forest.v2'],
    'm': ['terrain.mountain.default', 'terrain.mountain.v2'],
    's': ['terrain.water.shallow.default', 'terrain.water.shallow.v2'],
    'o': ['terrain.ocean.default', 'terrain.ocean.v2'],
}
MAP = [
    'o o o s s p p f',
    'o o s s p p f f',
    'o s p p p m f p',
    's s p p m m p p',
    's p p f p p p f',
    'p p f f p p f p',
    'p f p p p f p p',
    'p p p f p p p p',
]
MAP = [row.split() for row in MAP]
PLAYERS = {'red': '#E53935', 'blue': '#1E88E5'}
CITIES = {(2, 3): ('city.orchard.tier1', 'red'), (6, 5): ('city.forest.tier1', 'blue')}
OVERLAYS = {
    (1, 2): 'resource.fish.default', (2, 2): 'resource.fruit.default', (1, 4): 'resource.crops.default',
    (3, 4): 'resource.ore.default', (4, 3): 'resource.animals.default', (7, 6): 'feature.village.default',
    (5, 0): 'feature.ruins.default', (3, 2): 'improvement.farm.default', (5, 6): 'improvement.lumber_camp.default',
    (2, 5): 'improvement.mine.default',
}
UNITS = {
    (2, 4): ('unit.infantry.orchard.idle', 'red'), (3, 3): ('unit.cavalry.orchard.idle', 'red'),
    (4, 1): ('unit.archer.orchard.idle', 'red'), (5, 4): ('unit.infantry.forest.idle', 'blue'),
    (6, 4): ('unit.cavalry.forest.idle', 'blue'), (7, 4): ('unit.archer.forest.idle', 'blue'),
    (4, 2): ('unit.infantry.orchard.idle', 'blue'),  # same faction, other player
}
EFFECTS = {(5, 4): 'effect.hit', (4, 1): 'effect.heal'}
ROAD_PATH = [(2, 3), (3, 3), (4, 4), (5, 5), (6, 5)]
DIRS = {(-1, 0): 'n', (-1, 1): 'ne', (0, 1): 'e', (1, 1): 'se', (1, 0): 's', (1, -1): 'sw', (0, -1): 'w', (-1, -1): 'nw'}

def find(sprite_id):
    hits = list(SVG.glob(f'*/{sprite_id}.svg'))
    if not hits: raise SystemExit(f'missing sprite {sprite_id}')
    return hits[0]

def anchor(path):
    w, h = map(float, re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', path.read_text()).groups())
    fam = path.parent.name
    if fam == 'terrain': return (48, 72) if h == 104 else (48, 40)
    if fam == 'cities': return (48, 88)
    if fam == 'units': return (32, 60) if w == 64 else (24, 60)
    if fam == 'effects': return (24, 24)
    return (48, 40)  # overlays

def shade(hex_, k):
    r, g, b = (int(hex_[i:i + 2], 16) for i in (1, 3, 5))
    f = (lambda c: c + (255 - c) * k) if k > 0 else (lambda c: c * (1 + k))
    return '#%02X%02X%02X' % tuple(round(f(c)) for c in (r, g, b))

def layer(path, keep, tmp):
    """Terrain SVG with only its ground or props group, the way the engine draws them in separate passes."""
    drop = 'props' if keep == 'ground' else 'ground'
    src = re.sub(rf'<g id="{drop}">.*?</g>', '', path.read_text(), flags=re.S)
    out = Path(tmp) / f'{path.stem}.{keep}.svg'
    out.write_text(src)
    return out

def tinted(path, color, tmp):
    src = path.read_text()
    def fix(m):
        tone = re.search(r'data-tone="(\w+)"', m.group(0))
        k = {'light': 0.25, 'dark': -0.3}.get(tone.group(1) if tone else 'mid', 0)
        return m.group(0).replace('#BDBDBD', shade(color, k))
    src = re.sub(r'<g id="owner">.*?</g>', lambda g: re.sub(r'<[^>]*#BDBDBD[^>]*>', fix, g.group(0)), src, flags=re.S)
    out = Path(tmp) / f'{path.stem}.{color[1:]}.svg'
    out.write_text(src)
    return out

def render(z, dest, tmp):
    cache = {}
    def img(sprite_id, color=None, part=None):
        key = (sprite_id, color, part)
        if key not in cache:
            p = find(sprite_id)
            src = layer(p, part, tmp) if part else tinted(p, color, tmp) if color else p
            png = Path(tmp) / f'{src.stem}@{z}.png'
            subprocess.run(['rsvg-convert', '-z', str(z), str(src), '-o', str(png)], check=True)
            cache[key] = (Image.open(png).convert('RGBA'), anchor(p))
        return cache[key]

    n = len(MAP); W = TW * z
    out = Image.new('RGBA', (W * (n + 1), W * (n + 3) // 2), (38, 42, 50, 255))
    ox, oy = out.width / 2, W * 1.1
    def put(sprite_id, r, c, color=None, lift=0, part=None):
        im, (ax, ay) = img(sprite_id, color, part)
        sx, sy = ox + (c - r) * W / 2, oy + (c + r) * W / 4 - lift * z
        out.alpha_composite(im, (round(sx - ax * z), round(sy - ay * z)))

    cells = sorted(((r, c) for r in range(n) for c in range(n)), key=lambda rc: (rc[0] + rc[1], rc[1]))
    tile = lambda r, c: T[MAP[r][c]][(r * 3 + c * 5) % len(T[MAP[r][c]])]
    # 1. terrain ground
    for r, c in cells:
        if (r, c) in CITIES: continue  # city sprite carries its own ground
        put(tile(r, c), r, c, part='ground')
    # 2. roads, own pass
    links = {}
    for a, b in zip(ROAD_PATH, ROAD_PATH[1:]):
        links.setdefault(a, []).append(DIRS[(b[0] - a[0], b[1] - a[1])])
        links.setdefault(b, []).append(DIRS[(a[0] - b[0], a[1] - b[1])])
    for (r, c), ds in links.items():
        if (r, c) in CITIES: continue
        put('road.center', r, c)
        for d in ds: put(f'road.{d}', r, c)
    # 3. per tile back to front: terrain props, overlay, city, unit, effect
    for r, c in cells:
        if (r, c) not in CITIES: put(tile(r, c), r, c, part='props')
        if (r, c) in OVERLAYS: put(OVERLAYS[(r, c)], r, c)
        if (r, c) in CITIES: put(CITIES[(r, c)][0], r, c, PLAYERS[CITIES[(r, c)][1]])
        if (r, c) in UNITS: put(UNITS[(r, c)][0], r, c, PLAYERS[UNITS[(r, c)][1]])
        if (r, c) in EFFECTS: put(EFFECTS[(r, c)], r, c, lift=34)
    out.save(dest); print(dest, out.size)

with tempfile.TemporaryDirectory() as tmp:
    OUT.mkdir(parents=True, exist_ok=True)
    render(1, OUT / 'svg-scene-1x.png', tmp)
    render(2, OUT / 'svg-scene-2x.png', tmp)
