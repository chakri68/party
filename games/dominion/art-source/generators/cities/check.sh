#!/bin/bash
# usage: check.sh id   -> exports + views
A=/home/chakradharreddy/Repos/personal_projects/games/games/dominion/art-source/svg
S=/tmp/claude-1000/-home-chakradharreddy-Repos-personal-projects-games/2d85fb7f-4b91-4346-bc35-6a285049287d/scratchpad/svgcheck/cities
id=$1
rsvg-convert -w 192 -h 240 $A/cities/$id.svg -o $A/_exports/$id.png
for col in E53935 1E88E5; do
  python3 - $A/cities/$id.svg $S/$id.$col.svg $col <<'PY'
import sys,re
t=open(sys.argv[1]).read()
def rep(m): return m.group(0).replace('#BDBDBD','#'+sys.argv[3])
t=re.sub(r'<g id="owner">.*?</g>',rep,t,flags=re.S)
open(sys.argv[2],'w').write(t)
PY
  rsvg-convert -w 96 -h 120 $S/$id.$col.svg -o $S/$id.$col.1x.png
  rsvg-convert -w 288 -h 360 $S/$id.$col.svg -o $S/$id.$col.3x.png
done
rsvg-convert -w 96 -h 72 $A/terrain/terrain.plains.default.svg -o $S/plains1x.png
python3 - $S $id <<'PY'
import sys
from PIL import Image
S,id=sys.argv[1:]
t=Image.open(f'{S}/plains1x.png').convert('RGBA')
cities={c:Image.open(f'{S}/{id}.{c}.1x.png').convert('RGBA') for c in ['E53935','1E88E5']}
W,H=96*3+40,48*3+80
g=Image.new('RGBA',(W,H),(30,30,30,255))
ox,oy=W//2-48,60
cells=sorted([(i,j) for i in range(3) for j in range(3)],key=lambda p:p[0]+p[1])
own={(1,1):'E53935',(0,2):'1E88E5'}
for i,j in cells:
    if (i,j) in own: g.alpha_composite(cities[own[(i,j)]],(ox+(i-j)*48,oy+(i+j)*24-48))
    else: g.alpha_composite(t,(ox+(i-j)*48,oy+(i+j)*24))
g.save(f'{S}/{id}.grid1x.png')
g.resize((W*3,H*3),Image.NEAREST).save(f'{S}/{id}.grid3x.png')
a=cities['E53935'];b=Image.open(f'{S}/{id}.E53935.3x.png').convert('RGBA')
v=Image.new('RGBA',(b.width+a.width*1+30+b.width,b.height),(30,30,30,255))
v.alpha_composite(b,(0,0)); v.alpha_composite(a,(b.width+10,0))
v.alpha_composite(Image.open(f'{S}/{id}.1E88E5.3x.png').convert('RGBA'),(b.width+a.width+20,0))
v.save(f'{S}/{id}.view.png')
PY
