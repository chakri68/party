import math
OUT='/home/chakradharreddy/Repos/personal_projects/games/games/dominion/art-source/svg/effects'
def h(v): return round(v*2)/2
def fmt(v): v=h(v); return str(int(v)) if v==int(v) else str(v)
def P(pts,fill,c=None):
    s=' '.join(f'{fmt(x)},{fmt(y)}' for x,y in pts)
    return (f'  <!-- {c} -->\n' if c else '')+f'  <polygon points="{s}" fill="{fill}"/>'
def pol(cx,cy,r,a): a=math.radians(a); return (cx+r*math.cos(a), cy+r*math.sin(a))
def write(name,polys):
    body='\n'.join(polys)
    open(f'{OUT}/effect.{name}.svg','w').write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">\n{body}\n</svg>\n')
def star(cx,cy,spikes,inner,rot=0):
    # spikes: list of (angle, radius); valleys midway at radius inner
    pts=[]; n=len(spikes)
    for i,(a,R) in enumerate(spikes):
        a2=spikes[(i+1)%n][0]
        if a2<a: a2+=360
        pts.append(pol(cx,cy,R,a)); pts.append(pol(cx,cy,inner,(a+a2)/2))
    return pts
def scale(pts,cx,cy,k): return [(cx+(x-cx)*k, cy+(y-cy)*k) for x,y in pts]
def diamond(cx,cy,w,hh,L,D,c=None):
    # light left half, dark right half
    return [P([(cx,cy-hh),(cx-w,cy),(cx,cy+hh)],L,c), P([(cx,cy-hh),(cx+w,cy),(cx,cy+hh)],D)]
def kite(cx,cy,a,r0,r1,rt,wid,L,D,c=None):
    # radial ray: base at r0, shoulders at r1 (+-wid deg), tip at rt. L = counter-clockwise half
    b=pol(cx,cy,r0,a); t=pol(cx,cy,rt,a); s1=pol(cx,cy,r1,a-wid); s2=pol(cx,cy,r1,a+wid)
    return [P([b,s1,t],L,c),P([b,t,s2],D)]
def lit(a):
    # which half of a radial ray faces the upper-left light: returns True if ccw half (a-wid side) is lit
    # direction of light from upper-left: (-1,-1). ccw side normal = (sin a, -cos a)
    r=math.radians(a); return (math.sin(r)*-1 + -math.cos(r)*-1) > 0

# 1 hit
C=24
# 5 wedges, irregular so it reads as an impact, not a sheriff badge
maj=[(-98,23),(-28,18.5),(28,23),(112,19.5),(196,22.5)]
mins=[]
sp=sorted(maj+mins)
rim=star(C,C,sp,8.5)
hit=[P(rim,'#A8322F','rim (apple red dark) so the edges survive on grass and water')]
body=star(C,C,[(a,R-2.5) for a,R in sp],6.5)
hit.append(P(body,'#FF8A3D','wedges, shaded tone (underlay)'))
# lit half of each long wedge: centre, tip, and the valley on the side facing up-left
n=len(sp)
for i,(a,R) in enumerate(sp):
    if (a,R) not in maj: continue
    tip=body[2*i]; vprev=body[(2*i-1)%(2*n)]; vnext=body[2*i+1]
    up=lambda p:(p[0]+p[1])
    v=vprev if up(vprev)<up(vnext) else vnext
    hit.append(P([(C,C),v,tip],'#FFC94A','lit half' if i==1 else None))
hit.append(P([pol(C,C,5.5,a) for a in (-110,-50,10,70,130,190)],'#FFF3B0','core'))
write('hit',hit)

# 2 heal: bevelled plus, lit edge up-left, shade edge down-right, sparkles rising up-right
def cross(cx,cy,L,W):
    a,b=L/2,W/2
    return [(cx-b,cy-a),(cx+b,cy-a),(cx+b,cy-b),(cx+a,cy-b),(cx+a,cy+b),(cx+b,cy+b),(cx+b,cy+a),(cx-b,cy+a),(cx-b,cy+b),(cx-a,cy+b),(cx-a,cy-b),(cx-b,cy-b)]
hx,hy=20,27
heal=[P(cross(hx,hy,28,13),'#2E7D32','rim (orchard leaf dark) so green survives on grass')]
# hip-roofed plus: every arm has a ridge down its middle; halves facing up-left are light
a,b=12,4.5
Lt,Md,Dk='#E9FFE0','#8EF07A','#3FBF5A'
heal.append(P(cross(hx,hy,2*a,2*b),Md,'face underlay (seam backing)'))
heal.append(P([(hx-b,hy-a),(hx,hy-a),(hx,hy),(hx-b,hy-b)],Lt,'top arm'))
heal.append(P([(hx,hy-a),(hx+b,hy-a),(hx+b,hy-b),(hx,hy)],Md))
heal.append(P([(hx-a,hy-b),(hx-b,hy-b),(hx,hy),(hx-a,hy)],Lt,'left arm'))
heal.append(P([(hx-a,hy),(hx,hy),(hx-b,hy+b),(hx-a,hy+b)],Md))
heal.append(P([(hx,hy),(hx+b,hy-b),(hx+a,hy-b),(hx+a,hy)],Md,'right arm'))
heal.append(P([(hx,hy),(hx+a,hy),(hx+a,hy+b),(hx+b,hy+b)],Dk))
heal.append(P([(hx,hy),(hx+b,hy+b),(hx+b,hy+a),(hx,hy+a)],Dk,'bottom arm'))
heal+=diamond(37,16,3.5,5,'#E9FFE0','#3FBF5A','rising sparkles, big to small')
heal+=diamond(31,7,2.5,3.5,'#E9FFE0','#3FBF5A')
heal+=diamond(42,6,2,3,'#E9FFE0','#3FBF5A')
write('heal',heal)

# 3 capture: ring of 8 short rays, long/short alternating, lit half toward up-left
back=[]
for i in range(8):
    a=-90+i*45; long=i%2==0
    back.append(pol(C,C,(21 if long else 17.5)+2.5,a)); back.append(pol(C,C,9.5,a+22.5))
cap=[P(back,'#5A3820','backing star (walnut dark): keeps the gold off the gold Orchard units')]
for i in range(8):
    a=-90+i*45; long=i%2==0
    LT,DK='#F7D57A','#C99A2E'
    if not lit(a): LT,DK=DK,LT
    cap+=kite(C,C,a,9,13 if long else 11.5,21 if long else 17.5,13 if long else 15,LT,DK,'rays: half facing the light straw light, other half straw dark' if i==0 else None)
cap+=diamond(C,C,7,8,'#FBF3E1','#F2C14E','centre mark, big enough to cover most of the backing')
write('capture',cap)

# 4 spawn: a flat ground ring (same diamond projection as the tiles) with diamonds lifting off it
cx,cy,W,H,k=24,38,19,9.5,0.55
o=[(cx,cy-H),(cx+W,cy),(cx,cy+H),(cx-W,cy)]
n=[(cx,cy-H*k),(cx+W*k,cy),(cx,cy+H*k),(cx-W*k,cy)]
sp=[]
for s,(f,cm) in enumerate([('#FFFFFF','ground ring: back-left light, back-right and front-left mid, front-right shade'),('#EEF2F5',None),('#D9C9A6',None),('#EEF2F5',None)]):
    sp.append(P([o[s],o[(s+1)%4],n[(s+1)%4],n[s]],f,cm))
sp+=diamond(24,25,4.5,8,'#FBF3E1','#D9C9A6','rising diamonds, shrinking as they go')
sp+=diamond(16,15,3,4.5,'#FFFFFF','#D9C9A6')
sp+=diamond(31.5,12,3,4,'#FBF3E1','#D9C9A6')
sp+=diamond(24,6,2.5,3.5,'#FFFFFF','#D9C9A6')
write('spawn',sp)

# 5 research: cut gem (crown + pavilion) with a fan of four short rays above it
gx=24
rs=[P([(9.5,22),(16.5,13.5),(31.5,13.5),(38.5,22),(24,43.5)],'#5A3820','rim (walnut dark), same job as on capture')]
rs.append(P([(12,22),(18,16),(30,16),(36,22),(24,40)],'#F2C14E','gem underlay (straw mid)'))
rs.append(P([(12,22),(18,16),(21,22)],'#F7D57A','crown: left light, table cream, right dark'))
rs.append(P([(18,16),(30,16),(27,22),(21,22)],'#FBF3E1'))
rs.append(P([(30,16),(36,22),(27,22)],'#C99A2E'))
rs.append(P([(21,22),(27,22),(24,40)],'#F7D57A','pavilion: centre catches light, right in shade'))
rs.append(P([(27,22),(36,22),(24,40)],'#C99A2E'))
for k,a in enumerate((-155,-112,-68,-25)):
    LT,DK='#FBF3E1','#C99A2E'
    if not lit(a): LT,DK=DK,LT
    rs+=kite(gx,23,a,14,17,23,12,LT,DK,'insight rays' if k==0 else None)
write('research',rs)

# 6 discovery: four-point crystal star plus three satellites
dx,dy=21,27
arms={'up':(dx,dy-19),'right':(dx+15,dy),'down':(dx,dy+17),'left':(dx-15,dy)}
r=3.5
ul,ur,dr,dl=(dx-r,dy-r),(dx+r,dy-r),(dx+r,dy+r),(dx-r,dy+r)
c=(dx,dy)
L,M,D='#9EE7F5','#5CC3E6','#6A5BD8'
ds=[P([arms['up'],ur,arms['right'],dr,arms['down'],dl,arms['left'],ul],M,'star underlay (crystal mid)')]
ds.append(P([arms['up'],c,ul],L,'arms: up-left halves light, down-right halves dark'))
ds.append(P([arms['left'],ul,c],L))
ds.append(P([arms['right'],c,dr],D))
ds.append(P([arms['down'],dr,c],D))
def sat(x,y,R,cm=None):
    q=R*0.28
    full=[(x,y-R),(x+q,y-q),(x+R,y),(x+q,y+q),(x,y+R),(x-q,y+q),(x-R,y),(x-q,y-q)]
    return [P(full,M,cm),P([(x,y-R),(x,y),(x-R,y),(x-q,y-q)],L)]
ds+=sat(38,10,7,'satellites')
ds+=sat(40,36,4.5)
ds+=sat(7,9,4)
write('discovery',ds)
