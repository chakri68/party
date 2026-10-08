"""effect.hit: debris shards flying outward from an empty center. Prints the SVG."""
import math

# (angle deg, distance of shard center, length, width) — irregular on purpose
SHARDS = [(-80, 14, 13, 7), (-20, 15, 12, 6), (35, 14, 14, 7), (95, 15, 11, 6),
          (150, 14, 13, 7), (205, 15, 11, 6)]
SPECKS = [(-50, 19, 2.5), (65, 20, 2.5), (180, 20, 2), (245, 19, 2)]
LIGHT, DARK = '#FFFFFF', '#A8A49B'  # snow light, stone mid

def h(v):
    v = round(v * 2) / 2
    return int(v) if v == int(v) else v
def pt(cx, cy, a, d): return (h(cx + d * math.cos(a)), h(cy + d * math.sin(a)))

out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">',
       '  <!-- debris shards flying outward; engine animates the scatter. Each shard: lit half + shadow half,',
       '       tip pointing along its direction of travel. -->']
for deg, dist, ln, wd in SHARDS:
    a = math.radians(deg)
    cx, cy = 24 + dist * math.cos(a), 24 + dist * math.sin(a)
    tip, tail = pt(cx, cy, a, ln * 0.6), pt(cx, cy, a, -ln * 0.4)
    side1, side2 = pt(cx, cy, a + math.pi / 2, wd / 2), pt(cx, cy, a - math.pi / 2, wd / 2)
    # the side facing up-left is lit
    lit, shade = (side1, side2) if (side1[1] - side2[1]) + (side1[0] - side2[0]) < 0 else (side2, side1)
    out.append(f'  <polygon points="{tip[0]},{tip[1]} {lit[0]},{lit[1]} {tail[0]},{tail[1]}" fill="{LIGHT}"/>')
    out.append(f'  <polygon points="{tip[0]},{tip[1]} {tail[0]},{tail[1]} {shade[0]},{shade[1]}" fill="{DARK}"/>')
out.append('  <!-- dust specks -->')
for deg, dist, r in SPECKS:
    a = math.radians(deg)
    cx, cy = h(24 + dist * math.cos(a)), h(24 + dist * math.sin(a))
    out.append(f'  <polygon points="{cx},{cy - r} {cx + r},{cy} {cx},{cy + r} {cx - r},{cy}" fill="{LIGHT}"/>')
out.append('</svg>')
print('\n'.join(out))
