import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
A='/home/chakradharreddy/Repos/personal_projects/games/games/dominion/art-source/svg'
OUT={}

# ---------- fruit ----------
PROF=[(6,4),(14,8),(24,6),(31,0)]
def prof(z):
    for (z0,r0),(z1,r1) in zip(PROF,PROF[1:]):
        if z0<=z<=z1: return r0+(r1-r0)*(z-z0)/(z1-z0)
    return 4
def fruit():
    it=[]
    it.append(('trunk', solid(box(-1,-1,0,2,2,8),'walnut')))
    pts=ngon(0,0,4,6,6,0.2)+ngon(0,0,8,7,14,0.5)+ngon(0,0,6,6,24,0.1)+[(0.5,-0.5,31)]
    it.append(('bush: faceted dome; light kept to the crown so the edge survives on light grass', solid(pts,'foliage',th=(0.85,0.35))))
    fr=[]
    for th,z in [(-40,22),(10,25),(95,18),(40,15),(140,10),(-5,8)]:
        a=math.radians(th+45); r=prof(z)-0.3
        fr.append((r*math.cos(a)+r*math.sin(a)*0, z, a, r))
    for th,z in [(-45,21),(5,26),(55,20),(-20,12),(35,10)]:
        a=math.radians(th+45); r=prof(z)-0.6
        u=r*math.cos(a); v=r*math.sin(a)
        it.append(('fruit cube', solid(box(u-1.2,v-1.2,z-2,2.4,2.4,4.5),'red')))
    return it
OUT['resources/resource.fruit.default']=fruit

def rock(cu,cv,r,h,seed,ru=1.0):
    rnd=random.Random(seed); pts=[]
    for i in range(6):
        a=2*math.pi*i/6+rnd.uniform(-.3,.3); rr=r*rnd.uniform(.85,1.1)
        pts.append((cu+rr*ru*math.cos(a),cv+rr*math.sin(a),0))
    for i in range(4):
        a=2*math.pi*i/4+rnd.uniform(-.4,.4)+.4; rr=r*.7*rnd.uniform(.8,1.1)
        pts.append((cu+rr*ru*math.cos(a),cv+rr*math.sin(a),h*rnd.uniform(.5,.75)))
    pts.append((cu+rnd.uniform(-1,0),cv+rnd.uniform(-1,0),h))
    return pts
def crystal(cu,cv,z0,r,h,du,dv,n=4,rot=0.3):
    return ngon(cu,cv,r,n,z0,rot)+[(x+du*.6,y+dv*.6,z+h*.6) for x,y,z in ngon(cu,cv,r*.9,n,z0,rot)]+[(cu+du,cv+dv,z0+h)]

def ore():
    it=[]
    TH=(0.5,0.12)
    it.append(('rock back (big)', solid(rock(-1,-2,7.5,17,3),'stone')))
    it.append(('crystal shard tall', solid(crystal(-1,-1,10,2.2,22,-0.5,-1.5),'ice',th=TH)))
    it.append(('crystal shard left lean', solid(crystal(-3.5,1.5,9,1.6,14,-1,3),'ice',th=TH)))
    it.append(('crystal shard right lean', solid(crystal(2.5,-2.5,10,1.6,15,3,-1),'ice',th=TH)))
    it.append(('rock left', solid(rock(-3,7,4.5,10,7),'stone')))
    it.append(('rock right', solid(rock(7,2.5,4.5,9,11),'stone')))
    it.append(('crystal small right', solid(crystal(7,3,6,1.3,10,1.5,0.5),'ice',th=TH)))
    return it
OUT['resources/resource.ore.default']=ore

def crops():
    it=[]
    it.append(('tilled patch', flat([P((-9.5,-9.5,0)),P((9.5,-9.5,0)),P((9.5,9.5,0)),P((-9.5,9.5,0))],PAL['earth'][1])))
    rows=[(-7,[-6.5,-2,2.5,7]),(-2.5,[-4.5,0,4.5]),(2,[-7,-2.5,2,6.5]),(6.5,[-4.5,0,4.5])]
    for v,us in rows:
        for u in us:
            pts=[(u,v,1)]+ngon(u,v,1.25,4,6,0.8)+ngon(u,v,1.0,4,11,0.8)+[(u,v,16)]
            it.append(('wheat ear', solid(pts,'gold',th=(0.5,0.12))))
    return it
OUT['resources/resource.crops.default']=crops


# ---------- animals ----------
def goat(u0,v0,facing,graze=False,mat='horse'):
    """facing +1: head toward +u (screen right-down); -1: toward -u."""
    it=[]; L=6.0; W=3.0
    bu=u0-L/2; bv=v0-W/2
    def legs(vv):
        out=[]
        for du in (0.3, L-1.1):
            out+=solid(box(bu+du,vv,0,0.9,0.9,6),mat,underlay=False)
        return out
    it.append(('goat far legs', legs(bv)))
    it.append(('goat body', solid(box(bu,bv,5.5,L,W,7),mat)))
    it.append(('goat near legs', legs(bv+W-0.9)))
    hu = bu+L if facing>0 else bu
    tu = bu-0.6 if facing>0 else bu+L
    it.append(('tail', solid(box(tu,v0-0.4,10.5,0.6,0.8,2.5),mat,underlay=False)))
    if not graze:
        nu = hu-1.6 if facing>0 else hu-0.4
        it.append(('neck', solid(box(nu,v0-0.8,10,2,1.6,4),mat)))
        hx = nu+0.9 if facing>0 else nu-1.6
        it.append(('head', solid(box(hx,v0-0.9,12.5,2.7,1.8,3.5),mat)))
        ex = hx+0.6 if facing>0 else hx+1.4
        it.append(('horns', solid([(ex,v0-0.8,16),(ex+0.9,v0-0.8,16),(ex,v0+0.8,16),(ex+0.9,v0+0.8,16),(ex-3*facing,v0,21)],'walnut',underlay=False,th=(0.62,0.3))))
    else:
        nu = hu-1.4 if facing>0 else hu-0.6
        it.append(('neck (lowered)', solid([(nu,v0-0.8,12),(nu+2,v0-0.8,12),(nu,v0+0.8,12),(nu+2,v0+0.8,12),(nu+1+1.8*facing,v0-0.8,3),(nu+1+3*facing,v0-0.8,3),(nu+1+1.8*facing,v0+0.8,3),(nu+1+3*facing,v0+0.8,3)],mat)))
        hx = nu+1+2.4*facing - (0 if facing>0 else 2.6)
        it.append(('head (grazing)', solid(box(hx,v0-0.9,0.5,2.6,1.8,3.5),mat)))
        ex = hx+0.4 if facing>0 else hx+1.6
        it.append(('horns', solid([(ex,v0-0.8,4),(ex+0.9,v0-0.8,4),(ex,v0+0.8,4),(ex+0.9,v0+0.8,4),(ex-3*facing,v0,8)],'walnut',underlay=False)))
    return it
def animals():
    return goat(-6.5,1,-1)+goat(4,-1.5,1,graze=True,mat='bone')
OUT['resources/resource.animals.default']=animals

# ---------- fish ----------
def fishpolys(cx,cy,ang,sc=1.0,flip=False):
    a=math.radians(ang); ca,sa=math.cos(a),math.sin(a)
    def T(x,y):
        x*=sc; y*=sc
        return (r5(cx+x*ca-y*sa), r5(cy+x*sa+y*ca))
    nose=(8,0); top=(0,-3.5); tj=(-5,-0.3); bot=(1,3); c=(0.5,0.3)
    oc=PAL['ocean']; sn=PAL['snow']
    out=[]
    out.append(([T(*p) for p in [nose,top,tj,bot]],oc[1]))
    out.append(([T(*p) for p in [nose,top,c]],oc[0]))
    out.append(([T(*p) for p in [top,tj,c]],oc[1]))
    out.append(([T(*p) for p in [nose,c,bot]],sn[0]))
    out.append(([T(*p) for p in [c,tj,bot]],sn[2]))
    out.append(([T(*p) for p in [(-4.5,-0.3),(-9,-3.5),(-7.5,0)]],oc[2]))
    out.append(([T(*p) for p in [(-4.5,-0.3),(-7.5,0),(-8.5,3)]],oc[1]))
    out.append(([T(*p) for p in [(1,-3.4),(-3,-4.3),(-2.5,-2)]],oc[2]))
    return out
def fish():
    it=[]
    sh=PAL['shallow']; sn=PAL['snow']
    it.append(('ripple ring (flat, on the water)', flat([P((-5,-1,0)),P((-1,-5,0)),P((4,-4,0)),P((5,1,0)),P((1,5,0)),P((-4,4,0))],sh[0])))
    it.append(('ripple hole', flat([P((-3,-0.5,0)),P((-0.5,-3,0)),P((2.5,-2.5,0)),P((3,0.5,0)),P((0.5,3,0)),P((-2.5,2.5,0))],sh[1])))
    it.append(('fish rising (back-left)', fishpolys(37,32,-40,1.3)))
    it.append(('fish diving (front-right)', fishpolys(59,32,45,1.3)))
    it.append(('splash wedge', [
        ([(42,43),(44,34),(47,42)],sn[0]),
        ([(46,42.5),(49,32),(51,42.5)],sn[1]),
        ([(50,42.5),(54,35),(55,43.5)],sn[2]),
        ([(41,44),(47,41.5),(55,43),(49,46)],sh[0]),
    ]))
    it.append(('droplets', [([(38,36),(39.5,34),(40,36.5)],sn[0]),([(56,32),(57.5,30.5),(58,32.5)],sn[1])]))
    return it
OUT['resources/resource.fish.default']=fish

# ---------- village ----------
def hut(u,v,r,h,rh,doorside=True):
    it=[]
    n=8; rot=math.radians(22.5)
    wall=ngon(u,v,r,n,0,rot)+ngon(u,v,r,n,h,rot)
    it.append(('hut wall', solid(wall,'earth',th=(0.62,0.15))))
    if doorside:
        a0=math.radians(22.5); a1=math.radians(67.5)
        p0=(u+r*math.cos(a0),v+r*math.sin(a0)); p1=(u+r*math.cos(a1),v+r*math.sin(a1))
        def lp(t,z): return (p0[0]+(p1[0]-p0[0])*t, p0[1]+(p1[1]-p0[1])*t, z)
        it.append(('door', flat([P(lp(.3,0)),P(lp(.7,0)),P(lp(.7,h*.55)),P(lp(.3,h*.55))],PAL['earth'][2])))
    roof=ngon(u,v,r+1.1,n,h-0.5,rot)+[(u,v,h+rh)]
    it.append(('conical straw roof', solid(roof,'sand',th=(0.75,0.45))))
    return it
def village():
    it=[]
    it+=hut(-4.5,-4.5,3.8,9,11)
    it+=hut(6,-5,3,7.5,9)
    it+=hut(-5,6,3,7.5,9)
    st=PAL['stone']
    for (u,v) in [(3.5,3),(6,3.5),(3,5.5)]:
        it.append(('fire stone', solid(box(u-.6,v-.6,0,1.4,1.4,1.5),'stone',underlay=False)))
    it.append(('flame', solid([(4,3.5,0),(6,3.5,0),(4,5.5,0),(6,5.8,0),(5,4.5,9)],'red',underlay=True)))
    it.append(('flame core', solid([(4.8,4.4,0),(5.8,4.6,0),(4.9,5.6,0),(5.3,4.9,5.5)],'gold',underlay=False)))
    for (u,v) in [(7,5.5),(5.5,7)]:
        it.append(('fire stone front', solid(box(u-.6,v-.6,0,1.4,1.4,1.5),'stone',underlay=False)))
    return it
OUT['features/feature.village.default']=village

# ---------- ruins ----------
def column(u,v,r,tops,z0=0,n=6,rot=0.5):
    base=ngon(u,v,r,n,z0,rot)
    top=[(x,y,z0+tops[i%len(tops)]) for i,(x,y,_) in enumerate(ngon(u,v,r,n,0,rot))]
    return base+top
def ruins():
    it=[]
    # arch fragment, back: two piers + lintel
    it.append(('arch pier left', solid(box(-8,-6,0,2.5,2.5,16),'stone')))
    it.append(('arch lintel', solid(box(-8,-6,16,8,2.5,3.5),'stone')))
    it.append(('arch pier right (broken)', solid(column(-0.5,-4.75,1.3,[12,11,9,10],n=4,rot=math.radians(45)),'stone')))
    it.append(('moss on lintel', flat([P((-8,-6,19.5)),P((-4.5,-6,19.5)),P((-5.5,-3.5,19.5)),P((-8,-3.5,19.5))],PAL['foliage'][0])))
    it.append(('standing column (broken top)', solid(column(5.5,-4,2,[17,15,12,11,13,16]),'stone')))
    it.append(('column plinth', solid(box(3,-1.6,0,5,1.2,2),'stone',underlay=False)))
    it.append(('stub column', solid(column(4,5,1.8,[7,6,4,4.5,6.5,7.5]),'stone')))
    # fallen column lying along u
    rr=1.7; ang=[math.radians(a) for a in range(0,360,60)]
    fallen=[(u,-6+rr*math.cos(a)*1.0,rr+rr*math.sin(a)) for u in (-5,4-2) for a in ang]
    fallen=[(uu-3,6+vv+6,zz) for uu,vv,zz in fallen]
    it.append(('fallen column', solid(fallen,'stone')))
    it.append(('moss on ground', flat([P((-10,1,0)),P((-6,0,0)),P((-5,3,0)),P((-9,4,0))],PAL['foliage'][2])))
    return it
OUT['features/feature.ruins.default']=ruins

if __name__=='__main__':
    want=sys.argv[1:]
    for k,f in OUT.items():
        if want and not any(w in k for w in want): continue
        s,c=svg(f()); p=f'{A}/{k}.svg'
        os.makedirs(os.path.dirname(p),exist_ok=True)
        open(p,'w').write(s); print(k,c)
