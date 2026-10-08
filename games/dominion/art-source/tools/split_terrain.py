"""Wrap each terrain SVG's polygons into <g id="ground"> and <g id="props">. Idempotent.

usage: python3 -I split_terrain.py <svg>...

Ground is the leading run of polygons that stays inside the tile's diamond+slab hexagon; the first
polygon that leaves it starts props. Terrain files are authored slab → ground facets → props, so the
rule holds; check the output render if a new tile breaks that order.
"""
import re, sys
from pathlib import Path

POLY = re.compile(r'[ \t]*<polygon\b[^>]*/>\n?|[ \t]*<!--.*?-->\n?', re.S)

def inside(x, y, top):
    # hexagon: diamond (48,top)(96,top+24)(48,top+48)(0,top+24) plus 8-unit slab under the lower edges
    cy = top + 24
    if not (0 - 0.01 <= x <= 96.01): return False
    half = 24 * (1 - abs(x - 48) / 48)  # diamond half-height at this x
    return cy - half - 0.01 <= y <= cy + half + 8.01

def split(path):
    src = path.read_text()
    if 'id="ground"' in src: return 'skip'
    top = 48 if 'viewBox="0 0 96 104"' in src else 16
    head, body_tail = src.split('>', 1)
    body, tail = body_tail.rsplit('</svg>', 1)
    items = [m.group(0) for m in POLY.finditer(body)]
    ground, props, in_props, pending = [], [], False, []
    for it in items:
        if it.lstrip().startswith('<!--'):
            pending.append(it); continue
        pts = [tuple(map(float, p.split(','))) for p in re.search(r'points="([^"]+)"', it).group(1).split()]
        if not in_props and not all(inside(x, y, top) for x, y in pts):
            in_props = True
        (props if in_props else ground).extend(pending + [it]); pending = []
    props.extend(pending)
    ind = lambda xs: ''.join('  ' + x if not x.startswith('    ') else x for x in xs)
    out = f'{head}>\n  <g id="ground">\n{ind(ground)}  </g>\n  <g id="props">\n{ind(props)}  </g>\n</svg>{tail}'
    path.write_text(out)
    return f'{sum(1 for x in ground if "<polygon" in x)} ground / {sum(1 for x in props if "<polygon" in x)} props'

for a in sys.argv[1:]:
    print(Path(a).name, split(Path(a)))
