import sys
from PIL import Image
S=sys.argv[1]
ids=["plains.default","plains.v2","plains.v3","forest.default","forest.v2","mountain.default","mountain.v2","water.shallow.default","water.shallow.v2","ocean.default","ocean.v2"]
# 4x sheet, 4 per row
ims=[Image.open(f"{S}/terrain.{i}.4x.png").convert("RGBA") for i in ids]
cols=4; cw=384+8; ch=416+8
sheet=Image.new("RGBA",(cols*cw,((len(ims)+cols-1)//cols)*ch),(40,42,54,255))
for k,im in enumerate(ims):
    x=(k%cols)*cw; y=(k//cols)*ch+(416-im.height)
    sheet.alpha_composite(im,(x,y))
sheet.save(f"{S}/sheet4x.png")
# 1x strip scaled 3x nearest for viewing at true pixel res
ims1=[Image.open(f"{S}/terrain.{i}.1x.png").convert("RGBA") for i in ids]
strip=Image.new("RGBA",(len(ims1)*100,108),(40,42,54,255))
for k,im in enumerate(ims1): strip.alpha_composite(im,(k*100,104-im.height))
strip.save(f"{S}/strip1x.png")
strip.resize((strip.width*2,strip.height*2),Image.NEAREST).save(f"{S}/strip1x_2.png")
# mixed grid
import random
random.seed(3)
types=["plains.default","plains.v2","plains.v3","forest.default","forest.v2","mountain.default","mountain.v2","water.shallow.default","water.shallow.v2","ocean.default","ocean.v2"]
N=6
lay=[["ocean.default","ocean.v2","ocean.default","water.shallow.default","plains.v2","mountain.v2"],
     ["ocean.v2","water.shallow.v2","water.shallow.default","plains.default","forest.v2","mountain.default"],
     ["water.shallow.default","water.shallow.v2","plains.v3","forest.default","plains.v2","forest.v2"],
     ["plains.v3","plains.default","forest.v2","water.shallow.default","ocean.default","plains.default"],
     ["mountain.v2","forest.default","plains.v2","water.shallow.v2","ocean.v2","water.shallow.default"],
     ["plains.default","mountain.default","plains.v3","plains.default","water.shallow.default","ocean.default"]]
W=N*96+96; H=N*48+140
g=Image.new("RGBA",(W,H),(40,42,54,255))
ox=W//2-48; oy=60
order=sorted([(r+c,r,c) for r in range(N) for c in range(N)])
for _,r,c in order:
    t=lay[r][c]; im=ims1[ids.index(t)]
    x=ox+(c-r)*48; y=oy+(c+r)*24
    if t.startswith("mountain"): y-=32
    g.alpha_composite(im,(x,y))
g.save(f"{S}/grid1x.png")
g.resize((W*2,H*2),Image.NEAREST).save(f"{S}/grid2x.png")
