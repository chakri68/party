GRASS = ("#8BC34A", "#6BAA3E", "#4E8A34")
EARTH = ("#9A6A42", "#8A5A33", "#5E3B20")
STONE = ("#C9C6BF", "#A8A49B", "#7E7A72")
FOL = ("#7CC25A", "#5A9E44", "#3F7A32")
LEAF = ("#5CBF60", "#4CAF50", "#2E7D32")
RED = ("#E8635D", "#D64541", "#A8322F")
GOLD = ("#F7D57A", "#F2C14E", "#C99A2E")
CREAM = ("#FBF3E1", "#F4E9D0", "#D9C9A6")
WOOD = ("#9A6A42", "#7A4E2D", "#5A3820")
RUST = ("#E8884A", "#C8642E", "#9A4720")
CHAR = ("#6E6B78", "#4F4C58", "#34323C")
BONE = ("#F3EAD6", "#E2D3B4", "#BFAE8C")
L, M, D = 0, 1, 2
OWNER = "#BDBDBD"

class SVG:
    def __init__(s):
        s.out = []
        s.n = 0
    def c(s, t):
        s.out.append(f"  <!-- {t} -->")
    def poly(s, pts, fill, indent="  ", extra=""):
        pts = [(round(x * 2) / 2, round(y * 2) / 2) for x, y in pts]
        f = lambda n: str(int(n)) if n == int(n) else f"{n:.1f}"
        st = " ".join(f"{f(x)},{f(y)}" for x, y in pts)
        s.out.append(f'{indent}<polygon points="{st}" fill="{fill}"{extra}/>')
        s.n += 1
    def under(s, pts, fill):
        s.poly(hull(pts), fill)
    def write(s, path):
        body = "\n".join(s.out)
        open(path, "w").write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 120" width="96" height="120">\n{body}\n</svg>\n')
        return s.n

def P(u, v, z=0):
    return (48 + 2 * u - 2 * v, 64 + u + v - z)

def hull(pts):
    pts = sorted(set(pts))
    if len(pts) < 3: return pts
    cr = lambda o, a, b: (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cr(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cr(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]

def ground(s):
    s.c("earth slab")
    s.poly([(0, 88), (48, 112), (48, 120), (0, 96)], EARTH[M])
    s.poly([(48, 112), (96, 88), (96, 96), (48, 120)], EARTH[D])
    s.c("grass: mid underlay, light up-left, dark right")
    s.poly([(48, 64), (96, 88), (48, 112), (0, 88)], GRASS[M])
    s.poly([(0, 88), (48, 64), (64, 72), (62, 86), (26, 91)], GRASS[L])
    s.poly([(64, 72), (96, 88), (84, 94), (62, 86)], GRASS[D])

def box(s, a, b, cc, d, z0, h, mat, top=True, left=M, right=D, toptone=L, underlay=False):
    z1 = z0 + h
    lf = [P(a, d, z0), P(b, d, z0), P(b, d, z1), P(a, d, z1)]
    rf = [P(b, d, z0), P(b, cc, z0), P(b, cc, z1), P(b, d, z1)]
    tp = [P(a, cc, z1), P(b, cc, z1), P(b, d, z1), P(a, d, z1)]
    if underlay:
        s.under(lf + rf + (tp if top else []), mat[M])
    s.poly(lf, mat[left]); s.poly(rf, mat[right])
    if top: s.poly(tp, mat[toptone])

def hiproof(s, a, b, cc, d, h, rise, mat, o=1, hip=2):
    ea, eb, ec, ed = a - o, b + o, cc - o, d + o
    zr = h + rise; vr = (cc + d) / 2
    ra, rb = a + hip, b - hip
    front = [P(ea, ed, h), P(eb, ed, h), P(rb, vr, zr), P(ra, vr, zr)]
    rhip = [P(eb, ed, h), P(eb, ec, h), P(rb, vr, zr)]
    allp = front + rhip + [P(ea, ec, h)]
    s.under(allp, mat[M])
    s.poly(front, mat[L]); s.poly(rhip, mat[D])
    return P(ra, vr, zr), P(rb, vr, zr)

def bush(s, u, v, mat, sz=2.5, hgt=4):
    x, y = P(u, v)
    s.poly([(x - 2*sz, y), (x - sz, y - hgt), (x, y - hgt - 1), (x, y + 1.5)], mat[M])
    s.poly([(x, y - hgt - 1), (x + sz, y - hgt), (x + 2*sz, y), (x, y + 1.5)], mat[D])
    s.poly([(x - sz, y - hgt), (x, y - hgt - 1.5), (x + sz, y - hgt), (x, y - hgt + 1)], mat[L])
