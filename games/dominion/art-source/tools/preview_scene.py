"""Compose a sample isometric map from concept PNGs at real game scale."""
import sys, random
from pathlib import Path
from PIL import Image

C = Path(sys.argv[1])  # concepts dir
OUT = Path(sys.argv[2])

def load(p): return Image.open(p).convert('RGBA')

def diamond(im):
    """Left/right diamond vertices: outermost columns with real coverage (ignores stray specks)."""
    a = im.getchannel('A'); w, h = im.size
    px = a.load()
    cols = [x for x in range(w) if sum(1 for y in range(0, h, 2) if px[x, y] > 128) >= 8]
    lx, rx = cols[0] + 2, cols[-1] - 2
    def topmost(x):
        return next(y for y in range(h) if px[x, y] > 128)
    return lx, rx, (topmost(lx) + topmost(rx)) / 2

def tile_sprite(name, W):
    im = load(C / name)
    lx, rx, vy = diamond(im)
    s = W / (rx - lx)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    # anchor = diamond centre
    return im, ((lx + rx) / 2 * s, vy * s)

def standing(name, W, width_frac):
    im = load(C / name); im = im.crop(im.getchannel('A').point(lambda v: 255 if v > 128 else 0).getbbox())
    s = W * width_frac / im.width
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    return im, (im.width / 2, im.height * 0.97)  # feet at bottom centre

def city(W):
    im = load(C / 'm1/city.orchard.tier1.png'); im = im.crop(im.getchannel('A').point(lambda v: 255 if v > 128 else 0).getbbox())
    lx, rx, vy = diamond(im)
    s = W / (rx - lx)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    return im, ((lx + rx) / 2 * s, vy * s)

T = 'terrain/'
MAP = [
 'o o o s s p'.split(),
 'o s s p p f'.split(),
 's p p f m f'.split(),
 'p p f m m p'.split(),
 's p p p f p'.split(),
 'o s p f p p'.split(),
]
KIND = {
 'p': ['m1/terrain.plains.default.png', T+'terrain.plains.v2.png', T+'terrain.plains.v3.png'],
 'f': [T+'terrain.forest.default.png', T+'terrain.forest.v2.png'],
 'm': [T+'terrain.mountain.default.png', T+'terrain.mountain.v2.png'],
 's': [T+'terrain.water.shallow.default.png', T+'terrain.water.shallow.v2.png'],
 'o': [T+'terrain.ocean.default.png', T+'terrain.ocean.v2.png'],
}
CITY_AT, UNITS_AT = (3, 1), [(2, 2), (4, 3)]
R = 'resources/'
PROPS = {(1, 1): (R+'resource.fish.default.png', 0.5), (2, 1): (R+'resource.fruit.default.png', 0.42),
         (4, 1): (R+'resource.crops.default.png', 0.55), (3, 3): (R+'resource.ore.default.png', 0.45),
         (2, 3): (R+'resource.animals.default.png', 0.5), (4, 5): (R+'feature.village.default.png', 0.75)}

def render(W, path):
    random.seed(4)
    n = len(MAP)
    cw, ch = W * n + W, W * n // 2 + W * 2
    out = Image.new('RGBA', (cw, ch), (38, 42, 50, 255))
    ox, oy = cw / 2, W * 1.2
    cache = {}
    cells = sorted(((r, c) for r in range(n) for c in range(n)), key=lambda rc: (rc[0] + rc[1], rc[1]))
    for r, c in cells:
        name = random.choice(KIND[MAP[r][c]])
        if (r, c) == CITY_AT: name = KIND['p'][0]
        if name not in cache: cache[name] = tile_sprite(name, W)
        im, (ax, ay) = cache[name]
        sx, sy = ox + (c - r) * W / 2, oy + (c + r) * W / 4
        out.alpha_composite(im, (round(sx - ax), round(sy - ay)))
        if (r, c) == CITY_AT:
            ci, (cx, cy) = city(W)
            out.alpha_composite(ci, (round(sx - cx), round(sy - cy)))
        if (r, c) in PROPS:
            pn, frac = PROPS[(r, c)]
            pi, (px_, py_) = standing(pn, W, frac)
            out.alpha_composite(pi, (round(sx - px_), round(sy + W / 8 - py_)))
        if (r, c) in UNITS_AT:
            u, (ux, uy) = standing('m1/unit.infantry.orchard.idle.png', W, 0.42)
            out.alpha_composite(u, (round(sx - ux), round(sy + W / 8 - uy)))
    out.save(path)
    print(path, out.size)

render(96, OUT / 'scene-1x.png')
render(192, OUT / 'scene-2x.png')
