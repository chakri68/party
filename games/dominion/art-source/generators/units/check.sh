#!/bin/bash
# generate into scratch, build lineup scenes, render.
set -e
SC=/tmp/claude-1000/-home-chakradharreddy-Repos-personal-projects-games/2d85fb7f-4b91-4346-bc35-6a285049287d/scratchpad/svgcheck/units
SVG=/home/chakradharreddy/Repos/personal_projects/games/games/dominion/art-source/svg
mkdir -p $SC/out
python3 $SC/gen.py $SC/out
cp $SVG/units/unit.infantry.orchard.idle.svg $SC/out/
python3 - "$SC" "$SVG" <<'EOF'
import sys, re, os
sc, svg = sys.argv[1], sys.argv[2]
tile = open(f"{svg}/terrain/terrain.plains.default.svg").read()
tile_inner = re.sub(r"^<svg[^>]*>|</svg>\s*$", "", tile.strip())
order = ["unit.infantry.orchard.idle","unit.archer.orchard.idle","unit.cavalry.orchard.idle",
         "unit.infantry.forest.idle","unit.archer.forest.idle","unit.cavalry.forest.idle"]
def inner(uid, color):
    t = open(f"{sc}/out/{uid}.svg").read()
    m = re.search(r'viewBox="0 0 (\d+) (\d+)"', t)
    w,h = int(m.group(1)), int(m.group(2))
    body = re.sub(r"^<svg[^>]*>|</svg>\s*$", "", t.strip())
    if color:
        body = body.replace("#BDBDBD", color)
    return w,h,body
for name, colors in [("lineup", [None]*6), ("owners", ["#E53935","#1E88E5","#E53935","#1E88E5","#E53935","#1E88E5"]),
                     ("owners2", ["#1E88E5","#E53935","#1E88E5","#E53935","#1E88E5","#E53935"])]:
    parts=[]
    W = 96*6; H = 72+20
    for i,uid in enumerate(order):
        x0 = i*96; y0 = 20
        parts.append(f'<svg x="{x0}" y="{y0}" width="96" height="72" viewBox="0 0 96 72">{tile_inner}</svg>')
        w,h,b = inner(uid, colors[i])
        ax = 24 if w==48 else 32
        parts.append(f'<svg x="{x0+48-ax}" y="{y0+40-60}" width="{w}" height="{h}" viewBox="0 0 {w} {h}">{b}</svg>')
    open(f"{sc}/{name}.svg","w").write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -4 {W} {H+4}" width="{W}" height="{H+4}"><rect x="0" y="-4" width="{W}" height="{H+4}" fill="#333"/>' + "".join(parts) + "</svg>")
EOF
for n in lineup owners owners2; do
  rsvg-convert -z 1 $SC/$n.svg -o $SC/$n.1x.png
  rsvg-convert -z 3 $SC/$n.svg -o $SC/$n.3x.png
done
# validation
for f in $SC/out/*.svg; do
  b=$(basename $f)
  bad=$(grep -c -E 'stroke|gradient|filter|opacity|<style' $f || true)
  n=$(grep -c '<polygon' $f)
  xmllint --noout $f 2>&1 | head -2
  cols=$(grep -o 'fill="#[0-9A-Fa-f]*"' $f | sort -u | sed 's/fill="//;s/"//' )
  offp=""
  for col in $cols; do grep -qi "$col" $SVG/STYLE.md || offp="$offp $col"; done
  echo "$b polys=$n bad=$bad offpalette=[$offp]"
done
