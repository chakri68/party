import sys
from lib import *
s = SVG()
ground(s)

def lerp(p, q, t):
    return (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)

def horns(r1, r2):
    for (x, y), sgn in ((r1, -1), (r2, 1)):
        s.poly([(x, y + 1), (x + sgn * 4, y - 5), (x + sgn * 1, y - 0.5)], BONE[L])
        s.poly([(x, y + 1), (x - sgn * 1.5, y - 5), (x + sgn * 0.5, y - 0.5)], BONE[D])

def walls(name, a, b, cc, d, h, door_u=None, door_v=None):
    s.c(f"longhouse {name}: log walls")
    box(s, a, b, cc, d, 0, h, WOOD, top=False, underlay=True)
    for z in (2.5, 5):
        s.poly([P(a, d, z), P(b, d, z), P(b, d, z + 0.5), P(a, d, z + 0.5)], WOOD[D])
    if door_u is not None:
        s.poly([P(door_u, d, 0), P(door_u + 2.5, d, 0), P(door_u + 2.5, d, h - 1), P(door_u, d, h - 1)], CHAR[D])
    if door_v is not None:
        s.poly([P(b, door_v + 2.5, 0), P(b, door_v, 0), P(b, door_v, h - 1), P(b, door_v + 2.5, h - 1)], CHAR[D])

def roof_v(name, a, b, cc, d, h, rise, o=1, hip=2):
    """hip roof, ridge along v: +v hip light (small), +u slope dark (long)."""
    s.c(f"longhouse {name}: steep fur roof, ridge along v")
    ea, eb, ec, ed = a - o, b + o, cc - o, d + o
    zr = h + rise; ur = (a + b) / 2
    ra, rb = cc + hip, d - hip
    hipf = [P(ea, ed, h), P(eb, ed, h), P(ur, rb, zr)]
    side = [P(eb, ed, h), P(eb, ec, h), P(ur, ra, zr), P(ur, rb, zr)]
    s.under(hipf + side + [P(ea, ec, h)], CHAR[M])
    s.poly(side, CHAR[D]); s.poly(hipf, CHAR[L])
    q0, q1 = side[0], side[1]
    for t0 in (0.35,):
        s.poly([lerp(q0, side[3], t0), lerp(q1, side[2], t0), lerp(q1, side[2], t0 + 0.08), lerp(q0, side[3], t0 + 0.08)], CHAR[M])
    horns(P(ur, ra, zr), P(ur, rb, zr))

def roof_u(name, a, b, cc, d, h, rise, o=1, hip=2):
    s.c(f"longhouse {name}: steep fur roof, ridge along u")
    r1, r2 = hiproof(s, a, b, cc, d, h, rise, CHAR, o=o, hip=hip)
    ea, eb, ed = a - o, b + o, d + o
    f0, f1 = P(ea, ed, h), P(eb, ed, h)
    for t0 in (0.3, 0.62):  # fur bands across the front slope
        s.poly([lerp(f0, r1, t0), lerp(f1, r2, t0), lerp(f1, r2, t0 + 0.07), lerp(f0, r1, t0 + 0.07)], CHAR[M])
    horns(r1, r2)

def longhouse(name, a, b, cc, d, h, rise, door_u, shield_u=None, o=1.5, hip=2):
    s.c(f"longhouse {name}: log walls")
    box(s, a, b, cc, d, 0, h, WOOD, top=False, underlay=True)
    for z in (2, 4):  # log seams on the front wall
        s.poly([P(a, d, z), P(b, d, z), P(b, d, z + 0.5), P(a, d, z + 0.5)], WOOD[D])
    s.poly([P(door_u, d, 0), P(door_u + 2.5, d, 0), P(door_u + 2.5, d, h - 0.5), P(door_u, d, h - 0.5)], CHAR[D])
    s.c(f"longhouse {name}: steep fur roof")
    r1, r2 = hiproof(s, a, b, cc, d, h, rise, CHAR, o=o, hip=hip)
    s.c(f"longhouse {name}: bone horns at ridge ends")
    for (x, y), sgn in ((r1, -1), (r2, 1)):
        s.poly([(x, y + 1), (x + sgn * 4, y - 5), (x + sgn * 1, y - 0.5)], BONE[L])
        s.poly([(x, y + 1), (x - sgn * 1.5, y - 5), (x + sgn * 0.5, y - 0.5)], BONE[D])
    if shield_u is not None:
        s.c(f"longhouse {name}: round shield on the eave wall")
        x, y = P(shield_u, d + o + 0.2, h - 1.5)
        oct_ = [(x - 1.5, y - 3), (x + 1.5, y - 1.5), (x + 3, y + 0.5), (x + 3, y + 2.5), (x + 1.5, y + 4), (x - 1.5, y + 2.5), (x - 3, y + 0.5), (x - 3, y - 1.5)]
        # sits on the roof eave line, hung from the eave
        s.poly(oct_, RUST[M])
        s.poly([(x - 1, y - 0.5), (x + 1, y + 0.5), (x + 1, y + 1.5), (x - 1, y + 0.5)], BONE[L])

# banner pole, back right
s.c("banner pole with antler crown")
px, py = P(19, 0.5)
top = 36
s.poly([(px - 1, py - top), (px, py - top - 0.5), (px, py), (px - 1, py - 0.5)], WOOD[M])
s.poly([(px, py - top - 0.5), (px + 1, py - top), (px + 1, py - 0.5), (px, py)], WOOD[D])
s.poly([(px - 1, py - top), (px - 4, py - top - 5), (px - 2, py - top - 4), (px, py - top - 0.5)], BONE[L])
s.poly([(px, py - top - 0.5), (px + 3, py - top - 6), (px + 2.5, py - top - 3.5), (px + 1, py - top)], BONE[D])
ax, ay = px - 6, py - top + 3  # crossbar runs along u, centred on the pole
s.poly([(ax, ay - 0.5), (ax + 13, ay + 6), (ax + 13, ay + 7.5), (ax, ay + 1)], WOOD[M])
s.out.append('  <g id="owner">')
x0, y0, x1, y1 = ax + 1.5, ay + 1.5, ax + 11.5, ay + 6.5
s.poly([(x0, y0), (x1, y1), (x1, y1 + 15), ((x0 + x1) / 2, (y0 + y1) / 2 + 19), (x0, y0 + 15)], OWNER, "    ", ' data-tone="mid"')
s.poly([(x0, y0), (x1, y1), (x1, y1 + 2), (x0, y0 + 2)], OWNER, "    ", ' data-tone="dark"')
s.out.append("  </g>")

# conifer, back left
s.c("conifer")
tx, ty = P(4, 6)
s.poly([(tx - 1.5, ty - 4), (tx + 1.5, ty - 4), (tx + 1.5, ty + 0.5), (tx - 1.5, ty + 0.5)], WOOD[D])
s.under([(tx - 8, ty - 3), (tx + 8, ty - 3), (tx, ty - 29)], FOL[M])
for yb, w, ht in ((ty - 3, 8, 13), (ty - 11, 6.5, 12), (ty - 18, 4.5, 11)):
    s.poly([(tx - w, yb), (tx, yb - ht), (tx, yb + 1.5)], FOL[M])
    s.poly([(tx, yb - ht), (tx + w, yb), (tx, yb + 1.5)], FOL[D])
    s.poly([(tx - w, yb), (tx, yb - ht), (tx - w * 0.3, yb - ht * 0.3)], FOL[L])

walls("B (back right)", 12, 19, 1.5, 10.5, 6, door_v=5)
roof_v("B (back right)", 12, 19, 1.5, 10.5, 6, 15)
walls("A (main, front left)", 1, 18, 13, 20, 7, door_u=7.5)
roof_u("A (main, front left)", 1, 18, 13, 20, 7, 17)

s.c("totem, front right, horned skull top")
tu, tv = 22.5, 12
box(s, tu - 0.75, tu + 0.75, tv - 0.75, tv + 0.75, 0, 13, WOOD, top=False)
box(s, tu - 0.75, tu + 0.75, tv - 0.75, tv + 0.75, 6, 2, RUST, top=False)
x, y = P(tu + 0.75, tv + 0.75, 13)
k = 0.7
S = lambda pts: [(x + dx * k, y + dy * k) for dx, dy in pts]
s.poly(S([(-3.5, -1), (-2.5, -5), (2.5, -5), (3.5, -1), (1.5, 2), (-1.5, 2)]), BONE[M])
s.poly(S([(-2.5, -5), (2.5, -5), (1.5, -3), (-1.5, -3)]), BONE[L])
s.poly(S([(-2, -2), (-0.5, -2), (-0.5, -0.5), (-2, -0.5)]), CHAR[D])
s.poly(S([(0.5, -2), (2, -2), (2, -0.5), (0.5, -0.5)]), CHAR[D])
s.poly(S([(-3.5, -4), (-6.5, -10), (-4.5, -10), (-2.5, -5)]), BONE[L])
s.poly(S([(2.5, -5), (4.5, -10), (6.5, -10), (3.5, -4)]), BONE[D])

s.c("hide drying rack")
pa, pb, rv = 19.5, 23, 19
for pu in (pa, pb):
    box(s, pu - 0.5, pu + 0.5, rv - 0.5, rv + 0.5, 0, 12, WOOD, top=False)
s.poly([P(pa - 1, rv + 0.5, 11), P(pb + 1, rv + 0.5, 11), P(pb + 1, rv + 0.5, 12.5), P(pa - 1, rv + 0.5, 12.5)], WOOD[L])
hx = [P(pa + 0.7, rv + 0.6, 10.5), P(pb - 0.7, rv + 0.6, 10.5), P(pb - 0.4, rv + 0.6, 6), P(pb - 1.2, rv + 0.6, 2.5), P(pa + 1.2, rv + 0.6, 2.5), P(pa + 0.4, rv + 0.6, 6)]
s.poly(hx, RUST[L])
s.poly([P(pa + 1.2, rv + 0.6, 2.5), P(pb - 1.2, rv + 0.6, 2.5), P(pb - 0.4, rv + 0.6, 6), P((pa + pb) / 2, rv + 0.6, 4.5), P(pa + 0.4, rv + 0.6, 6)], RUST[M])

s.c("woodpile, front corner")
box(s, 19, 23, 21.5, 23, 0, 3, WOOD, underlay=True)
for lu in (19.5, 21, 22.5):
    x, y = P(lu, 23, 1.5)
    s.poly([(x - 1, y - 1), (x, y - 1.5), (x + 1, y - 1), (x + 1, y + 0.5), (x, y + 1), (x - 1, y + 0.5)], BONE[D])

n = s.write(sys.argv[1])
print("polygons:", n)
