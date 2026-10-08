"""Emit improvement + road overlay SVGs as plain polygons. usage: python3 -I gen.py <svg-dir>"""
import sys
from pathlib import Path

OUT = Path(sys.argv[1])

EARTH = ('#9A6A42', '#8A5A33', '#5E3B20')
STONE = ('#C9C6BF', '#A8A49B', '#7E7A72')
SAND = ('#F2DDA4', '#E3C887', '#C4A86A')
GOLD = ('#F7D57A', '#F2C14E', '#C99A2E')
WAL = ('#9A6A42', '#7A4E2D', '#5A3820')
ORE = ('#9EE7F5', '#5CC3E6', '#6A5BD8')


def q(v):
    r = round(v * 2) / 2
    return int(r) if r == int(r) else r


def P(a, b):
    """diamond param: a along grid col (top->right vertex), b along grid row (top->left vertex), 0..1"""
    return (48 + 48 * a - 48 * b, 16 + 24 * a + 24 * b)


class Svg:
    def __init__(self):
        self.lines = []

    def c(self, text):
        self.lines.append(f'  <!-- {text} -->')

    def p(self, pts, fill):
        s = ' '.join(f'{q(x)},{q(y)}' for x, y in pts)
        self.lines.append(f'  <polygon points="{s}" fill="{fill}"/>')

    def box(self, x, y, la, lb, h, tones, top=True):
        """iso box; (x,y) = back ground corner; la/lb = extents in screen units along A=(2,1)/B=(-2,1) per step"""
        o = (x, y)
        a = (x + 2 * la, y + la)
        ab = (x + 2 * la - 2 * lb, y + la + lb)
        b = (x - 2 * lb, y + lb)
        up = lambda p: (p[0], p[1] - h)
        self.p([b, ab, up(ab), up(b)], tones[1])     # front-left face (+b)
        self.p([ab, a, up(a), up(ab)], tones[2])     # right face (+a)
        if top:
            self.p([up(o), up(a), up(ab), up(b)], tones[0])
        return up(o), up(a), up(ab), up(b)

    def write(self, name, head=''):
        body = '\n'.join(self.lines)
        txt = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 72" width="96" height="72">\n{head}{body}\n</svg>\n'
        (OUT / name).write_text(txt)
        n = sum(1 for l in self.lines if '<polygon' in l)
        print(name, n)


# ---------------------------------------------------------------- farm
def farm():
    s = Svg()
    a0, a1 = 4 / 48, 44 / 48
    b0, b1 = 4 / 48, 44 / 48
    s.c('field: earth underlay over the whole tilled area (diamond-aligned, inset 1/12 tile from the edge)')
    s.p([P(a0, b0), P(a1, b0), P(a1, b1), P(a0, b1)], EARTH[1])
    # strips run along the grid-col axis (screen down-right), alternating wheat / tilled earth, back to front
    bands = [(4, 14, 'wheat'), (14, 24, 'earth'), (24, 34, 'wheat'), (34, 44, 'earth')]
    h, tooth = 2.5, 2
    ra0, ra1 = a0 + 1 / 48, a1 - 1 / 48
    for bb0, bb1, kind in bands:
        bb0, bb1 = bb0 / 48, bb1 / 48
        if kind == 'earth':
            s.c('tilled strip: flat earth, furrow lines dark, ridge lines light')
            for k in range(3):
                f = bb0 + (1.5 + 3 * k) / 48
                s.p([P(ra0, f), P(ra1, f), P(ra1, f + 1 / 48), P(ra0, f + 1 / 48)], EARTH[0])
                s.p([P(ra0, f + 1 / 48), P(ra1, f + 1 / 48), P(ra1, f + 2 / 48), P(ra0, f + 2 / 48)], EARTH[2])
            continue
        s.c('wheat strip: raised block, front face mid, end dark, light top with toothed back and front edges')
        f0, f1 = bb0 + 1 / 48, bb1 - 1 / 48
        up = lambda p, d=h: (p[0], p[1] - d)
        s.p([P(ra0, f1), P(ra1, f1), up(P(ra1, f1)), up(P(ra0, f1))], GOLD[1])
        s.p([P(ra1, f1), P(ra1, f0), up(P(ra1, f0)), up(P(ra1, f1))], GOLD[2])
        n = 9
        back = []
        for i in range(n + 1):
            aa = ra0 + (ra1 - ra0) * i / n
            back.append(up(P(aa, f0)))
            if i < n:
                back.append(up(P(aa + (ra1 - ra0) / n / 2, f0), h + tooth))
        front = []
        for i in range(n, -1, -1):
            aa = ra0 + (ra1 - ra0) * i / n
            front.append(up(P(aa, f1)))
            if i > 0:
                front.append(up(P(aa - (ra1 - ra0) / n / 2, f1), h - 1.5))
        s.p(back + front, GOLD[0])
        # one row line down the middle of the top, so a strip reads as rows not a slab
        m = (f0 + f1) / 2
        s.p([up(P(ra0, m - 0.5 / 48)), up(P(ra1, m - 0.5 / 48)), up(P(ra1, m + 0.5 / 48)), up(P(ra0, m + 0.5 / 48))], GOLD[1])
    s.c('fence corner at the bottom vertex: posts are 1-step boxes, two rails per side')
    corner = P(45 / 48, 45 / 48)
    left = P(31 / 48, 45 / 48)
    right = P(45 / 48, 31 / 48)
    def post(g):
        x, y = g
        s.box(x, y - 1, 0.5, 0.5, 7, WAL)
    def rail(p0, p1, y0):
        (x0, ya), (x1, yb) = p0, p1
        s.p([(x0, ya - y0), (x1, yb - y0), (x1, yb - y0 - 1.5), (x0, ya - y0 - 1.5)], WAL[1])
    post(right)
    post(left)
    for y0 in (2.5, 5):
        rail(right, corner, y0)
        rail(left, corner, y0)
    post(corner)
    s.write('improvements/improvement.farm.default.svg')


# ---------------------------------------------------------------- lumber camp
def hip_roof(s, x, y, la, lb, ov, rise, tones):
    """hip roof over a box footprint with back corner (x,y); ridge along the A axis"""
    o = (x + 2 * (-ov) - 2 * (-ov), y - ov - ov)
    # eave corners with overhang ov on all sides
    bk = (x, y - 2 * ov)                                   # back
    rt = (x + 2 * (la + ov) - 2 * (-ov), y + (la + ov) + (-ov) - 0)  # placeholder, recomputed below
    E = lambda ea, eb: (x + 2 * ea - 2 * eb, y + ea + eb)
    bk, rt, fr, lf = E(-ov, -ov), E(la + ov, -ov), E(la + ov, lb + ov), E(-ov, lb + ov)
    inset = lb / 2 + ov
    r0, r1 = E(-ov + inset, lb / 2), E(la + ov - inset, lb / 2)
    r0, r1 = (r0[0], r0[1] - rise), (r1[0], r1[1] - rise)
    s.p([bk, rt, r1, r0], tones[1])        # back slope mid
    s.p([lf, bk, r0], tones[0])            # left hip light
    s.p([lf, fr, r1, r0], tones[0])        # front slope light
    s.p([fr, rt, r1], tones[2])            # right hip dark


def log_end(s, cx, cy, r, tones):
    """cut log end facing +a (screen down-right): squashed hexagon, light upper half, mid lower"""
    pts = [(cx - r * 0.5, cy - r), (cx + r * 0.5, cy - r * 0.75), (cx + r * 0.75, cy), (cx + r * 0.5, cy + r),
           (cx - r * 0.5, cy + r * 0.75), (cx - r * 0.75, cy)]
    s.p(pts, tones[1])
    s.p([pts[0], pts[1], pts[2], pts[5]], tones[0])


def lumber():
    s = Svg()
    # hut toward the back-left, log pile front-right, stump front-left
    s.c('hut: walnut log walls, sand thatch hip roof (walnut-on-walnut would merge with the walls)')
    hx, hy = 38, 27
    s.box(hx, hy, 8, 5, 7, WAL, top=False)
    # door on front-left face, a log seam line on the right face
    s.c('door + wall seam')
    d0 = (hx - 10 + 2 * 3, hy + 5 + 3)
    s.p([d0, (d0[0] + 4, d0[1] + 2), (d0[0] + 4, d0[1] - 4), (d0[0], d0[1] - 6)], WAL[2])
    rf = (hx - 10 + 16, hy + 13)
    s.p([(rf[0], rf[1] - 4.5), (hx + 16, hy + 8 - 4.5), (hx + 16, hy + 8 - 5.5), (rf[0], rf[1] - 5.5)], WAL[1])
    hip_roof(s, hx, hy - 7, 8, 5, 1, 8, SAND)
    # log pile: logs lying along the B axis, cut ends facing +a; stacked 3-2-1
    s.c('log pile: logs lie along the grid-row axis, cut sand ends face down-right; stacked 3-2-1, back to front')
    L = 5  # log length in B steps
    def log(ex, ey, r=2.5):
        # body: band from far end (ex+2L, ey-L) to near end at (ex,ey); top light, underside mid
        fx, fy = ex + 2 * L, ey - L
        s.p([(fx, fy - r), (ex, ey - r), (ex - r * 0.75, ey), (fx - r * 0.75, fy)], WAL[0])
        s.p([(fx - r * 0.75, fy), (ex - r * 0.75, ey), (ex, ey + r), (fx, fy + r)], WAL[1])
        log_end(s, ex, ey, r, SAND)
    base = (58, 46)
    # bottom row along A axis (each next log further +a = down-right screen)
    rows = [[(0, 0), (1, 0), (2, 0)], [(0.5, 1), (1.5, 1)], [(1, 2)]]
    for row in rows:
        for i, lvl in row:
            ex = base[0] + i * 4.5
            ey = base[1] + i * 2.25 - lvl * 4.25
            log(ex, ey)
    # stump with axe, front-left
    s.c('stump: hex prism, sand cut top; axe head wedged in, handle leaning back-right')
    sx, sy = 31, 50
    w, d, hgt = 4, 2, 4
    top = [(sx - w, sy - hgt), (sx - w / 2, sy - hgt - d), (sx + w / 2, sy - hgt - d), (sx + w, sy - hgt),
           (sx + w / 2, sy - hgt + d), (sx - w / 2, sy - hgt + d)]
    s.p([(sx - w, sy - hgt), (sx - w / 2, sy - hgt + d), (sx - w / 2, sy + d), (sx - w, sy)], WAL[1])
    s.p([(sx - w / 2, sy - hgt + d), (sx + w / 2, sy - hgt + d), (sx + w / 2, sy + d), (sx - w / 2, sy + d)], WAL[1])
    s.p([(sx + w / 2, sy - hgt + d), (sx + w, sy - hgt), (sx + w, sy), (sx + w / 2, sy + d)], WAL[2])
    s.p(top, SAND[0])
    # axe: handle from blade at stump top to up-right
    s.p([(sx + 0.5, sy - hgt - 0.5), (sx + 1.5, sy - hgt), (sx + 8, sy - hgt - 5), (sx + 7.5, sy - hgt - 6)], WAL[0])
    # head: wedge sunk in the stump top
    s.p([(sx - 2.5, sy - hgt - 1), (sx + 1.5, sy - hgt - 3), (sx + 2, sy - hgt), (sx - 1.5, sy - hgt + 0.5)], STONE[0])
    s.p([(sx - 1.5, sy - hgt + 0.5), (sx + 2, sy - hgt), (sx + 2, sy - hgt + 1), (sx - 1, sy - hgt + 1.5)], STONE[2])
    # chips
    s.c('wood chips')
    for cx, cy in [(37, 55.5), (41, 53), (33, 55.5)]:
        s.p([(cx - 1.5, cy), (cx, cy - 0.5), (cx + 1.5, cy), (cx, cy + 0.5)], SAND[1])
    s.write('improvements/improvement.lumber_camp.default.svg')


# ---------------------------------------------------------------- mine
def mine():
    s = Svg()
    s.c('stone hillock in the lower front of the diamond, so the mountain peak stays readable behind it;')
    s.c('first polygon is the mid-stone silhouette underlay')
    sil = [(24, 50), (28, 42), (38, 35), (50, 33), (62, 36), (72, 45), (72, 51), (60, 57), (44, 58), (32, 55)]
    s.p(sil, STONE[1])
    s.p([(24, 50), (28, 42), (38, 35), (50, 33), (44, 42), (34, 50)], STONE[0])
    s.p([(50, 33), (62, 36), (58, 44), (44, 42)], STONE[0])
    s.p([(62, 36), (72, 45), (72, 51), (60, 57), (58, 44)], STONE[2])
    # portal on the front-left face (faces +b): plane spanned by A=(2,1) and vertical
    s.c('portal: dark adit in a timber frame; the frame plane faces down-left, so its horizontals slope 1:2')
    px, py = 44, 46   # left post base
    W, H = 14, 12
    at = lambda t, hh: (px + t, py + t / 2 - hh)
    side = lambda p, d: (p[0] + d, p[1] - d / 2)   # step back along -b (into the hill)
    s.p([at(2, 0), at(W - 2, 0), at(W - 2, H - 3), at(W / 2 + 2, H), at(W / 2 - 2, H), at(2, H - 3)], EARTH[2])
    s.p([at(2, H - 3), at(W / 2 - 2, H), at(2, H)], WAL[1])
    s.p([at(W - 2, H - 3), at(W - 2, H), at(W / 2 + 2, H)], WAL[1])
    for t0 in (0, W - 2):
        s.p([at(t0, 0), at(t0 + 2, 0), at(t0 + 2, H), at(t0, H)], WAL[0])
        s.p([at(t0 + 2, 0), side(at(t0 + 2, 0), 1.5), side(at(t0 + 2, H), 1.5), at(t0 + 2, H)], WAL[2])
    s.p([at(-1.5, H), at(W + 1.5, H), at(W + 1.5, H + 2.5), at(-1.5, H + 2.5)], WAL[1])
    s.p([at(-1.5, H + 2.5), at(W + 1.5, H + 2.5), side(at(W + 1.5, H + 2.5), 2), side(at(-1.5, H + 2.5), 2)], WAL[0])
    s.p([at(W + 1.5, H), side(at(W + 1.5, H), 2), side(at(W + 1.5, H + 2.5), 2), at(W + 1.5, H + 2.5)], WAL[2])
    s.c('rail pair out of the adit, running toward the viewer (grid-row axis)')
    for t0 in (4, 9):
        b0 = at(t0, 0)
        s.p([b0, (b0[0] + 1, b0[1] + 0.5), (b0[0] - 7, b0[1] + 4.5), (b0[0] - 8, b0[1] + 4)], WAL[2])
    s.c('ore cart parked beside the adit, long axis along the rails: walnut box (front mid, end dark, dark open top), iron wheels, stone + crystal heap')
    cx, cy = 33, 46
    o, a, ab, b = s.box(cx, cy, 2.5, 3, 4.5, WAL, top=False)
    s.p([o, a, ab, b], WAL[2])
    hx, hy = (o[0] + ab[0]) / 2, (o[1] + ab[1]) / 2
    s.p([b, (hx - 2.5, hy - 3.5), (hx + 1.5, hy - 5), a, ab], STONE[1])
    s.p([b, (hx - 2.5, hy - 3.5), (hx, hy)], STONE[0])
    s.p([(hx + 1.5, hy - 5), a, ab, (hx, hy)], STONE[2])
    s.p([(hx - 1, hy - 1), (hx + 0.5, hy - 4.5), (hx + 2.5, hy - 1)], ORE[1])
    s.p([(hx - 1, hy - 1), (hx + 0.5, hy - 4.5), (hx - 0.5, hy - 3)], ORE[0])
    s.p([(hx + 0.5, hy - 4.5), (hx + 2.5, hy - 1), (hx + 2, hy - 3)], ORE[2])
    # wheels on the +a face (the cart rolls along the grid-row axis)
    ax, ay = cy, 0
    for t0 in (1, 3):
        g = (a[0] - 2 * t0, a[1] + t0 + 4.5)   # ground point along the +a face base
        wx, wy = g[0], g[1] - 1.5
        s.p([(wx - 1.5, wy - 1), (wx, wy - 2), (wx + 1.5, wy - 1), (wx + 1.5, wy + 1), (wx, wy + 2), (wx - 1.5, wy + 1)], STONE[2])
        s.p([(wx - 0.5, wy - 0.5), (wx + 0.5, wy - 0.5), (wx + 0.5, wy + 0.5), (wx - 0.5, wy + 0.5)], STONE[0])
    s.write('improvements/improvement.mine.default.svg')


# ---------------------------------------------------------------- roads
# Ground-uniform road: half-width = HW tile units measured on the ground, perpendicular to travel.
# Screen per tile: +col = (48,24), +row = (-48,24).
DIRS = {  # name: (drow, dcol)
    'n': (-1, 0), 'ne': (-1, 1), 'e': (0, 1), 'se': (1, 1),
    's': (1, 0), 'sw': (1, -1), 'w': (0, -1), 'nw': (-1, -1),
}
HW = 1 / 12
RUT = (0.55, 0.8)   # rut band as fraction of half-width
ROAD = SAND[1]
RUTC = SAND[2]


def scr(dr, dc):
    return (48 * dc - 48 * dr, 24 * dc + 24 * dr)


def road(name):
    dr, dc = DIRS[name]
    # endpoint on the shared edge/vertex: half the step to the neighbour's center
    sx, sy = scr(dr, dc)
    end = (48 + sx / 2, 40 + sy / 2)
    # perpendicular in grid: (dc, -dr) rotated; normalise on the ground
    pr, pc = dc, -dr
    ln = (pr * pr + pc * pc) ** 0.5
    def off(f):
        x, y = scr(pr / ln * HW * f, pc / ln * HW * f)
        return (x, y)
    s = Svg()
    s.c(f'road segment "{name}": grid (drow={dr}, dcol={dc}); center (48,40) to {tuple(q(v) for v in end)}; '
        f'end cut is ground-perpendicular so it meets the neighbour\'s opposite segment edge to edge')
    def band(f0, f1, fill):
        o0, o1 = off(f0), off(f1)
        s.p([(48 + o0[0], 40 + o0[1]), (end[0] + o0[0], end[1] + o0[1]),
             (end[0] + o1[0], end[1] + o1[1]), (48 + o1[0], 40 + o1[1])], fill)
    band(-1, 1, ROAD)
    band(RUT[0], RUT[1], RUTC)
    band(-RUT[1], -RUT[0], RUTC)
    s.write(f'roads/road.{name}.svg')


def road_center():
    s = Svg()
    head = '''  <!-- Road overlay set. A tile's road = road.center + one road.<dir> per connected neighbour, same 96x72 overlay space.
       Directions are GRID terms (square grid, 8-neighbour), mapped to screen with +col = (+48,+24), +row = (-48,+24):
         n  (row-1)       -> upper-right edge midpoint (72,28)
         ne (row-1,col+1) -> right vertex  (96,40)
         e  (col+1)       -> lower-right edge midpoint (72,52)
         se (row+1,col+1) -> bottom vertex (48,64)
         s  (row+1)       -> lower-left edge midpoint (24,52)
         sw (row+1,col-1) -> left vertex   (0,40)
         w  (col-1)       -> upper-left edge midpoint (24,28)
         nw (row-1,col-1) -> top vertex    (48,16)
       Width is constant on the ground (1/6 tile), so screen width varies with direction:
       orthogonal ~8 across, ne/sw ~6 tall, nw/se ~11 wide. Each end is cut ground-perpendicular,
       so a segment and its neighbour's opposite segment share the end edge exactly.
       Diagonal ends straddle a vertex and spill half their width onto the two side tiles:
       draw overlays after all terrain, or the side tiles will clip the road to an hourglass. -->
'''
    s.c('hub: ground circle of radius ~1.4 half-widths as an iso octagon, ruts as cobble flecks')
    rx, ry = 9, 4.5
    import math
    pts = [(48 + rx * math.cos(math.radians(22.5 + 45 * k)), 40 + ry * math.sin(math.radians(22.5 + 45 * k))) for k in range(8)]
    s.p(pts, ROAD)
    for cx, cy in [(44, 39), (51, 38.5), (48, 42), (53.5, 41.5), (42.5, 42)]:
        s.p([(cx - 1.5, cy), (cx, cy - 0.75), (cx + 1.5, cy), (cx, cy + 0.75)], RUTC)
    s.write('roads/road.center.svg', head)


farm(); lumber(); mine(); road_center()
for d in DIRS:
    road(d)
