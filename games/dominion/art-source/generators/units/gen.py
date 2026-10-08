#!/usr/bin/env python3
"""Emit the five unit sprites as plain flat polygons. Run from anywhere."""
import os, sys

OUT = sys.argv[1] if len(sys.argv) > 1 else "."

P = {
    "gold": ("#F7D57A", "#F2C14E", "#C99A2E"),
    "green": ("#5CBF60", "#4CAF50", "#2E7D32"),
    "red": ("#E8635D", "#D64541", "#A8322F"),
    "cream": ("#FBF3E1", "#F4E9D0", "#D9C9A6"),
    "rust": ("#E8884A", "#C8642E", "#9A4720"),
    "fur": ("#6E6B78", "#4F4C58", "#34323C"),
    "bone": ("#F3EAD6", "#E2D3B4", "#BFAE8C"),
    "horse": ("#B98A5E", "#9C6E45", "#74502F"),
    "wal": ("#9A6A42", "#7A4E2D", "#5A3820"),
    "skin": ("#E8B48A", "#D49A6E", "#B07A52"),
}
OWNER = "#BDBDBD"
L, M, D = 0, 1, 2


def c(mat, tone):
    return P[mat][tone]


def fmt(v):
    v = round(v * 2) / 2
    return str(int(v)) if v == int(v) else str(v)


class S:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.body = []
        self.owner = []
        self.dx = self.dy = 0

    def note(self, text):
        self.body.append(f"  <!-- {text} -->")

    def poly(self, pts, fill, dx=None, dy=None):
        dx = self.dx if dx is None else dx
        dy = self.dy if dy is None else dy
        s = " ".join(f"{fmt(x + dx)},{fmt(y + dy)}" for x, y in pts)
        self.body.append(f'  <polygon points="{s}" fill="{fill}"/>')

    def own(self, pts, tone="mid", dx=None, dy=None):
        dx = self.dx if dx is None else dx
        dy = self.dy if dy is None else dy
        s = " ".join(f"{fmt(x + dx)},{fmt(y + dy)}" for x, y in pts)
        t = "" if tone == "mid" else f' data-tone="{tone}"'
        self.body.append(f'    <polygon points="{s}" fill="{OWNER}"{t}/>')

    def group_open(self, comment):
        self.note(comment)
        self.body.append('  <g id="owner">')

    def group_close(self):
        self.body.append("  </g>")

    def text(self):
        head = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.w} {self.h}" '
                f'width="{self.w}" height="{self.h}">')
        return "\n".join([head] + self.body + ["</svg>"]) + "\n"


# ---------------------------------------------------------------- factions
# Each faction maps body parts to materials. "trim" is the narrow accent.
ORCHARD = dict(
    tunic="gold", skirt="gold", stripe="green", belt="green", shorts="cream",
    cuff="green", sleeve="cream", wrist="green", shoulder="green",
    tip="cream", bind="green", fletch="red",
)
FOREST = dict(
    tunic="rust", skirt="rust", stripe="fur", belt="wal", shorts="fur",
    cuff="bone", sleeve="rust", wrist="fur", shoulder="fur",
    tip="bone", bind="rust", fletch="rust",
)


def legs(s, f):
    s.note("boots")
    s.poly([(17, 47), (22.5, 47), (22.5, 55), (23, 60), (14, 60), (14, 57), (17, 55)], c("wal", M))
    s.poly([(14, 57), (17, 55), (23, 55), (23, 57)], c("wal", L))
    s.poly([(25, 47), (30.5, 47), (30.5, 55), (31, 60), (24, 60), (24, 57), (25, 55)], c("wal", M))
    s.poly([(24, 57), (25, 55), (30.5, 55), (31, 57)], c("wal", L))
    s.poly([(28.5, 47), (30.5, 47), (30.5, 55), (31, 60), (29, 60), (28.5, 55)], c("wal", D))
    s.note("shorts + cuffs")
    s.poly([(17, 41), (23.5, 41), (23, 46), (17, 46)], c(f["shorts"], M))
    s.poly([(23.5, 41), (30, 41), (30.5, 46), (24.5, 46)], c(f["shorts"], D))
    s.poly([(16.5, 45.5), (23, 45.5), (23, 48), (16.5, 48)], c(f["cuff"], M))
    s.poly([(24.5, 45.5), (31, 45.5), (31, 48), (24.5, 48)], c(f["cuff"], D))


def skirt(s, f, stripe=True):
    s.note("skirt")
    s.poly([(17.5, 37), (25, 37), (25, 42), (16, 42)], c(f["skirt"], M))
    s.poly([(25, 37), (29.5, 37), (31, 42), (25, 42)], c(f["skirt"], D))
    if stripe:
        s.poly([(20, 38), (21.5, 38), (21.5, 42), (20, 42)], c(f["stripe"], M))


def torso(s, f, stripe=True, light=True, belt=True):
    s.note("torso")
    s.poly([(15.5, 24.5), (26, 24.5), (25, 37), (18, 37)], c(f["tunic"], M))
    s.poly([(26, 24.5), (32, 24.5), (29.5, 37), (25, 37)], c(f["tunic"], D))
    if light:
        s.poly([(16, 24.5), (26, 24.5), (25.5, 30), (17, 30)], c(f["tunic"], L))
    if stripe:
        s.poly([(25.5, 24.5), (27, 24.5), (26, 37), (24.5, 37)], c(f["stripe"], D))
    if not belt:
        return
    s.note("belt")
    s.poly([(17.5, 35.5), (25, 35.5), (25, 38), (17.5, 38)], c(f["belt"], M))
    s.poly([(25, 35.5), (29.5, 35.5), (29.5, 38), (25, 38)], c(f["belt"], D))


def shoulders(s, f, faction):
    s.note("collar + pauldrons" if faction == "orchard" else "fur mantle")
    if faction == "orchard":
        s.poly([(19, 24), (26, 24), (24.5, 27.5), (21.5, 27.5)], c("green", D))
        s.poly([(13, 24.5), (18, 24), (18.5, 28.5), (13, 29)], c("green", M))
        s.poly([(13, 24.5), (18, 24), (18, 26), (13, 26.5)], c("green", L))
        s.poly([(28, 24), (33, 24.5), (33.5, 29), (29, 28.5)], c("green", D))
    else:
        # one shaggy fur cape over both shoulders: ragged lower edge
        s.poly([(12.5, 24.5), (33.5, 24), (34, 29), (32, 28), (30.5, 30), (29, 28), (26, 29),
                (24, 27.5), (22, 29), (19.5, 27.5), (17.5, 30), (15.5, 28.5), (13, 30)], c("fur", M))
        s.poly([(12.5, 24.5), (22, 23.5), (21, 26), (17, 26.5), (12.5, 27)], c("fur", L))
        s.poly([(26.5, 23.5), (33.5, 24), (34, 29), (32, 28), (30.5, 30), (29, 28), (26, 29)], c("fur", D))


def arm(s, f):
    s.note("near arm")
    s.poly([(13.5, 28.5), (17.5, 28.5), (16.5, 31.5), (13, 31)], c(f["sleeve"], L))
    s.poly([(13, 31), (16.5, 31.5), (14, 33.5), (11.5, 33)], c("skin", M))
    s.poly([(11.5, 32), (14.5, 32.5), (13.5, 34.5), (11, 34)], c(f["wrist"], D))
    s.poly([(8.5, 31.5), (12.5, 31.5), (13, 35), (9, 35)], c("skin", L))


def head(s):
    s.note("head")
    s.poly([(18.5, 19.5), (26.5, 19.5), (26, 25), (19.5, 25)], c("skin", M))
    s.poly([(26.5, 19.5), (29.5, 19.5), (28.5, 24), (26, 25)], c("skin", D))


def helmet(s, faction):
    if faction == "orchard":
        s.note("helmet")
        s.poly([(17.5, 17), (18.5, 13), (23, 10), (22, 17)], c("gold", L))
        s.poly([(22, 17), (23, 10), (27, 11), (27, 17)], c("gold", M))
        s.poly([(27, 17), (27, 11), (30, 14), (30.5, 17)], c("gold", D))
        s.poly([(17, 16.5), (27, 16.5), (27, 19.5), (17.5, 19.5)], c("green", M))
        s.poly([(27, 16.5), (31, 16.5), (30.5, 19.5), (27, 19.5)], c("green", D))
        s.note("crest")
        s.poly([(24, 10.5), (27, 7), (28, 11)], c("green", L))
        s.poly([(27, 7), (30.5, 9.5), (28, 11)], c("green", D))
    else:
        s.note("antlers (behind the hood)")
        s.poly([(19, 12), (16, 6), (15, 2.5), (17.5, 6), (18, 3.5), (19, 7.5), (21, 11)], c("bone", L))
        s.poly([(27.5, 11), (29.5, 6.5), (30, 2), (31, 6.5), (33, 4), (32, 8.5), (29.5, 12.5)], c("bone", D))
        s.note("fur hood")
        s.poly([(17, 19.5), (17.5, 14), (21, 10.5), (23.5, 10), (22.5, 19.5)], c("fur", L))
        s.poly([(22.5, 19.5), (23.5, 10), (27, 10.5), (27.5, 19.5)], c("fur", M))
        s.poly([(27.5, 19.5), (27, 10.5), (30.5, 13), (31.5, 19.5)], c("fur", D))
        s.note("bone brow band")
        s.poly([(17, 17), (27.5, 17), (27.5, 19.5), (17, 19.5)], c("bone", M))
        s.poly([(27.5, 17), (31.5, 17), (31, 19.5), (27.5, 19.5)], c("bone", D))


def hood(s, faction):
    """Archer: soft hood with a drooping point to the back-right."""
    if faction == "orchard":
        base, trim = "gold", "green"
    else:
        base, trim = "fur", "bone"
    s.note("hood back + tail")
    s.poly([(17, 26), (17, 15), (21, 11), (26, 10.5), (30, 13), (32.5, 18), (36, 23), (31.5, 22.5),
            (30.5, 26)], c(base, D))
    head(s)
    s.note("hood crown")
    s.poly([(17, 17.5), (17.5, 14.5), (21, 11), (24, 10.5), (23, 17.5)], c(base, L))
    s.poly([(23, 17.5), (24, 10.5), (27, 11), (28, 17.5)], c(base, M))
    s.note("hood brim trim")
    s.poly([(16.5, 17), (28, 17), (28, 19.5), (17, 19.5)], c(trim, M))
    s.poly([(28, 17), (31, 17), (30.5, 19.5), (28, 19.5)], c(trim, D))
    if faction == "forest":
        s.note("bone toggle")
        s.poly([(21, 24.5), (25, 24.5), (24.5, 26.5), (21.5, 26.5)], c("bone", L))


def spear(s, f):
    s.note("spear shaft (behind hand)")
    s.poly([(9.5, 15), (11.5, 15), (12, 58), (10, 58)], c("wal", M))
    s.poly([(9.5, 15), (10.5, 15), (11, 58), (10, 58)], c("wal", L))
    s.note("spear tip")
    s.poly([(10.5, 3), (8, 9.5), (10.5, 15)], c(f["tip"], L))
    s.poly([(10.5, 3), (13, 9.5), (10.5, 15)], c(f["tip"], D))
    s.poly([(9, 14.5), (12, 14.5), (12, 17), (9, 17)], c(f["bind"], M))


def shield(s, faction):
    rim = "green" if faction == "orchard" else "wal"
    s.note("shield rim")
    if faction == "orchard":
        s.poly([(31, 28.5), (39, 28), (43, 32.5), (43, 43), (39.5, 47.5), (31.5, 48), (27.5, 43.5), (27.5, 33)], c(rim, D))
        s.poly([(27.5, 43.5), (27.5, 33), (31, 28.5), (39, 28), (43, 32.5), (35, 38), (29, 45)], c(rim, M))
        s.poly([(27.5, 40), (27.5, 33), (31, 28.5), (36, 28), (30, 31.5), (29.5, 39)], c(rim, L))
        s.group_open("shield face: player color")
        s.own([(33, 30.5), (39, 30), (41.5, 33.5), (41.5, 42), (39, 45.5), (33, 46), (30, 42.5), (30, 34)])
        s.group_close()
    else:
        # rounder: 12-gon rim, plank face
        s.poly([(31, 28.5), (35.5, 27.5), (40, 29), (42.5, 32), (43.5, 38), (42.5, 43.5),
                (40, 47), (35.5, 48.5), (31, 47.5), (28.5, 44), (27.5, 38), (28.5, 32)], c(rim, D))
        s.poly([(28.5, 44), (27.5, 38), (28.5, 32), (31, 28.5), (35.5, 27.5), (40, 29), (42.5, 32),
                (35, 38), (30, 45.5)], c(rim, M))
        s.poly([(27.5, 39), (27.5, 38), (28.5, 32), (31, 28.5), (35.5, 27.5), (37, 28), (31, 31), (29.5, 38)], c(rim, L))
        s.group_open("shield face: player color")
        s.own([(31.5, 31), (35.5, 30), (39.5, 31.5), (41.5, 34), (42, 38), (41, 42.5), (39, 45),
               (35.5, 46), (32, 45.5), (30, 42.5), (29.5, 38), (30, 34)])
        s.group_close()


# ------------------------------------------------------------------ units
def infantry(faction):
    f = ORCHARD if faction == "orchard" else FOREST
    s = S(48, 64)
    spear(s, f)
    legs(s, f)
    skirt(s, f)
    torso(s, f)
    shoulders(s, f, faction)
    arm(s, f)
    if faction == "forest":
        helmet(s, faction)
    head(s)
    if faction == "orchard":
        helmet(s, faction)
    shield(s, faction)
    return s


def quiver(s, f):
    s.note("arrows (fletching) + quiver on back")
    s.poly([(13, 12), (15.5, 9), (17, 13.5), (15, 15)], c(f["fletch"], L))
    s.poly([(16.5, 11), (19.5, 8.5), (20, 13.5), (17.5, 14.5)], c(f["fletch"], D))
    s.poly([(12.5, 15), (19, 13), (21.5, 25), (15.5, 26.5)], c("wal", M))
    s.poly([(12.5, 15), (15.5, 14), (18.5, 26), (15.5, 26.5)], c("wal", L))


def bow(s, f):
    s.note("far arm, reaching forward")
    s.poly([(30, 26), (34, 25.5), (37, 31), (34.5, 33)], c(f["sleeve"], D))
    s.poly([(34.5, 31.5), (37, 30.5), (38.5, 33), (36, 34.5)], c("skin", D))
    s.note("bow string")
    s.poly([(34.5, 17), (35, 17), (35, 51), (34.5, 51)], c("cream", D))
    s.note("bow")
    s.poly([(34, 16), (36, 15.5), (40, 24), (38, 25)], c("wal", L))
    s.poly([(38, 25), (40, 24), (41, 34), (39, 34)], c("wal", M))
    s.poly([(39, 34), (41, 34), (40, 44), (38, 43)], c("wal", M))
    s.poly([(38, 43), (40, 44), (36, 52.5), (34, 52)], c("wal", D))
    s.note("bow hand")
    s.poly([(37, 31.5), (41.5, 31.5), (42, 35.5), (37.5, 35.5)], c("skin", L))


def archer(faction):
    f = ORCHARD if faction == "orchard" else FOREST
    s = S(48, 64)
    quiver(s, f)
    legs(s, f)
    s.note("skirt")
    s.poly([(17.5, 37), (29.5, 37), (31, 42), (16, 42)], c(f["skirt"], D))
    torso(s, f, stripe=False, light=False, belt=False)
    s.group_open("tabard: player color")
    s.own([(17.5, 25), (25.5, 25), (25, 43.5), (17, 43.5)], tone="mid")
    s.own([(25.5, 25), (29.5, 25), (29, 43.5), (25, 43.5)], tone="dark")
    s.group_close()
    shoulders(s, f, faction)
    arm(s, f)
    hood(s, faction)
    bow(s, f)
    return s


def horse(s):
    H = "horse"
    s.note("tail")
    s.poly([(52, 34), (56, 34.5), (58.5, 43), (57.5, 50), (55, 49), (55.5, 42)], c("wal", D))
    s.note("far legs")
    s.poly([(22.5, 46), (26, 46), (25.5, 56), (23, 56)], c(H, D))
    s.poly([(22.5, 56), (26, 56), (26.5, 58), (22, 58)], c("wal", D))
    s.poly([(48.5, 44), (52, 43), (51.5, 56), (49, 56)], c(H, D))
    s.poly([(48.5, 56), (52, 56), (52.5, 58), (48, 58)], c("wal", D))
    s.note("barrel")
    s.poly([(16, 36), (22, 33), (48, 32), (53.5, 34), (54, 41), (51, 47), (23, 48.5), (16.5, 45)], c(H, M))
    s.poly([(22, 33), (48, 32), (53.5, 34), (47.5, 35.5), (23, 36)], c(H, L))
    s.poly([(47.5, 35.5), (53.5, 34), (54, 41), (51, 47), (48, 46.5)], c(H, D))
    s.poly([(22.5, 46), (48, 45), (51, 47), (23, 48.5)], c(H, D))
    s.note("chest")
    s.poly([(16, 36), (22, 33), (23, 36), (22.5, 48), (16.5, 45)], c(H, L))
    s.note("near legs")
    s.poly([(16, 44), (21.5, 45.5), (21, 57), (16.5, 57)], c(H, M))
    s.poly([(16, 44), (18, 44.5), (18, 57), (16.5, 57)], c(H, L))
    s.poly([(16, 57), (21.5, 57), (22, 60), (15.5, 60)], c("wal", D))
    s.poly([(41, 45), (48.5, 45), (47.5, 51), (48, 57), (44, 57), (43.5, 51)], c(H, M))
    s.poly([(46, 45), (48.5, 45), (47.5, 51), (48, 57), (46.5, 57), (46, 51)], c(H, D))
    s.poly([(43.5, 57), (48, 57), (48.5, 60), (43, 60)], c("wal", D))
    s.note("neck + mane")
    s.poly([(15, 39), (23.5, 34), (20, 22), (13.5, 20), (11, 28)], c(H, M))
    s.poly([(11, 28), (13.5, 20), (16, 20.5), (16, 38.5)], c(H, L))
    s.poly([(15, 19), (18, 18.5), (25, 33.5), (22.5, 34.5)], c("wal", D))
    s.note("head")
    s.poly([(9.5, 16), (16, 17.5), (14.5, 24), (9, 32), (4, 31.5), (3.5, 28)], c(H, M))
    s.poly([(9.5, 16), (12, 16.5), (6.5, 29), (3.5, 28)], c(H, L))
    s.poly([(14.5, 21.5), (16, 17.5), (14.5, 24), (9, 32), (8.5, 29)], c(H, D))
    s.poly([(3.5, 28), (7, 29.5), (6.5, 32), (4, 31.5)], c("wal", D))
    s.poly([(10.5, 16.5), (12, 12), (13.5, 17)], c("wal", D))
    s.note("reins")
    s.poly([(7.5, 26), (8.5, 25.5), (20, 30), (20, 31)], c("wal", D))


def cavalry(faction):
    f = ORCHARD if faction == "orchard" else FOREST
    s = S(64, 64)
    horse(s)
    s.group_open("saddle cloth (+ pennant below): player color")
    s.own([(24, 35), (44, 34.5), (44.5, 43.5), (24.5, 44.5)], tone="mid")
    s.own([(24, 33.5), (44, 33), (44, 35), (24, 35.5)], tone="light")
    s.own([(24.5, 43), (44.5, 42.5), (44.5, 45), (24.5, 46)], tone="dark")
    s.group_close()
    # rider: infantry upper body, seated (no skirt), shifted onto the saddle
    s.dx, s.dy = 9, -2
    torso(s, f)
    s.dx = s.dy = 0
    s.note("near leg (rider): thigh forward, boot down")
    s.poly([(22.5, 33), (32, 33), (31, 37.5), (23, 38)], c(f["shorts"], M))
    s.poly([(22.5, 37.5), (27.5, 37.5), (27.5, 39.5), (22.5, 39.5)], c(f["cuff"], M))
    s.poly([(23, 39.5), (27, 39.5), (27, 44.5), (28.5, 47), (22, 47), (22.5, 44.5)], c("wal", M))
    s.note("lance (behind hand)")
    s.poly([(14, 8), (16, 7.5), (23, 38), (21, 38.5)], c("wal", M))
    s.poly([(13, 0.5), (13, 8.5), (15, 8)], c(f["tip"], L))
    s.poly([(13, 0.5), (15, 8), (16.5, 7.5)], c(f["tip"], D))
    s.group_open("pennant: player color")
    s.own([(14.5, 9), (23.5, 11), (15.5, 13.5)], tone="mid")
    s.own([(14.5, 9), (23.5, 11), (18.5, 10.5)], tone="light")
    s.group_close()
    s.dx, s.dy = 9, -2
    shoulders(s, f, faction)
    arm(s, f)
    if faction == "forest":
        helmet(s, faction)
    head(s)
    if faction == "orchard":
        helmet(s, faction)
    s.dx = s.dy = 0
    return s


UNITS = {
    "unit.cavalry.orchard.idle": lambda: cavalry("orchard"),
    "unit.archer.orchard.idle": lambda: archer("orchard"),
    "unit.infantry.forest.idle": lambda: infantry("forest"),
    "unit.cavalry.forest.idle": lambda: cavalry("forest"),
    "unit.archer.forest.idle": lambda: archer("forest"),
}

if __name__ == "__main__":
    for uid, fn in UNITS.items():
        with open(os.path.join(OUT, uid + ".svg"), "w") as fh:
            fh.write(fn().text())
