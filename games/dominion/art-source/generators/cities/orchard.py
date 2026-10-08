import sys
from lib import *
s = SVG()
ground(s)

def cottage(name, a, b, cc, d, h, rise, door_u, win_v, win2_u=None):
    s.c(f"cottage {name}: chimney (behind ridge)")
    cu = b - 3
    box(s, cu, cu + 1.5, cc + 1.5, cc + 3, h, rise + 1, WOOD, underlay=False)
    s.c(f"cottage {name}: walls")
    box(s, a, b, cc, d, 0, h, CREAM, top=False, underlay=True)
    s.poly([P(door_u, d, 0), P(door_u + 2.5, d, 0), P(door_u + 2.5, d, 7), P(door_u, d, 7)], WOOD[M])
    s.poly([P(b, win_v + 1.5, 4), P(b, win_v - 1.5, 4), P(b, win_v - 1.5, 7.5), P(b, win_v + 1.5, 7.5)], WOOD[D])
    if win2_u is not None:
        s.poly([P(win2_u, d, 4), P(win2_u + 2.5, d, 4), P(win2_u + 2.5, d, 7.5), P(win2_u, d, 7.5)], WOOD[D])
    s.c(f"cottage {name}: hip roof")
    hiproof(s, a, b, cc, d, h, rise, RED, o=1.5, hip=2.5)
    s.c(f"cottage {name}: doorstep")
    s.poly([P(door_u - 0.5, d, 0), P(door_u + 3, d, 0), P(door_u + 3, d + 2, 0), P(door_u - 0.5, d + 2, 0)], WOOD[L])

# pole + pennant (back right, behind cottage B)
s.c("banner pole")
px, py = P(17, 0.5)
top = 34
s.poly([(px - 1, py - top), (px, py - top - 0.5), (px, py), (px - 1, py - 0.5)], WOOD[M])
s.poly([(px, py - top - 0.5), (px + 1, py - top), (px + 1, py - 0.5), (px, py)], WOOD[D])
ax, ay = px, py - top + 1
s.poly([(ax, ay), (ax + 11, ay + 5.5), (ax + 11, ay + 7), (ax, ay + 1.5)], WOOD[M])
s.out.append('  <g id="owner">')
x0, y0 = ax + 2, ay + 2.5
x1, y1 = ax + 10, ay + 6.5
s.poly([(x0, y0), (x1, y1), (x1, y1 + 14), (x1 - 4, y1 + 8.5), (x0, y0 + 14)], OWNER, "    ", ' data-tone="mid"')
s.out.append("  </g>")

# apple tree, back centre, trunk planted at P(3.5,3.5)
s.c("apple tree: trunk")
tx, ty = P(2.5, 2.5)
th = 11
s.poly([(tx - 3, ty - 1), (tx, ty + 0.5), (tx, ty - th), (tx - 2, ty - th - 0.5)], WOOD[M])
s.poly([(tx, ty + 0.5), (tx + 3, ty - 1), (tx + 2, ty - th - 0.5), (tx, ty - th)], WOOD[D])
s.c("apple tree: canopy")
cx, cy = tx + 1, ty - th - 8
R = [(0, -14), (9, -12), (14, -3), (12, 6), (5, 11), (-5, 11), (-12, 6), (-14, -3), (-9, -12)]
r = [(cx + dx, cy + dy) for dx, dy in R]
s.under(r, LEAF[M])
A_, B_, C_ = (cx - 2, cy - 5), (cx + 6, cy - 1), (cx - 1, cy + 5)
tris = [((r[0], r[1], A_), L), ((r[8], r[0], A_), L), ((r[7], r[8], A_), L),
        ((r[1], r[2], B_), D), ((r[2], r[3], B_), D), ((r[3], r[4], B_), D),
        ((r[4], r[5], C_), D), ((r[6], r[7], C_), M), ((r[7], A_, C_), L)]
for pts, t in tris:
    s.poly(list(pts), LEAF[t])
s.c("apples")
def apple(x, y):
    s.poly([(x - 2, y + 1), (x, y), (x + 2, y + 1), (x + 2, y + 3), (x, y + 4), (x - 2, y + 3)], RED[M])
    s.poly([(x - 2, y + 1), (x, y), (x + 2, y + 1), (x, y + 2)], RED[L])
apple(cx - 6, cy - 6); apple(cx + 5, cy - 9); apple(cx + 5, cy + 3)

s.c("bush behind cottages")
bush(s, 9, 10, LEAF, 2.5, 4)

cottage("A (left)", 1, 10.5, 13.5, 22, 10, 13, 3.5, 18)
cottage("B (right)", 14.5, 23, 6, 15.5, 10, 13, 15.5, 10.75, win2_u=19.5)

s.c("fence (front)")
fv = 19.5
posts = (13.5, 17, 20.5)
for z in (3, 6):
    s.poly([P(posts[0], fv + 0.5, z), P(posts[-1], fv + 0.5, z), P(posts[-1], fv + 0.5, z + 1.5), P(posts[0], fv + 0.5, z + 1.5)], WOOD[M])
for fu in posts:
    box(s, fu - 0.5, fu + 0.5, fv - 0.5, fv + 0.5, 0, 8, WOOD, left=L if False else M)

s.c("bushes (front)")
bush(s, 11, 23, LEAF, 2.5, 4)
bush(s, 22.5, 22, LEAF, 2.5, 4)
n = s.write(sys.argv[1])
print("polygons:", n)
