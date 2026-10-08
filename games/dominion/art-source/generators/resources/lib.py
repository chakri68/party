import math, itertools
PAL = {
 'grass':('#8BC34A','#6BAA3E','#4E8A34'),
 'earth':('#9A6A42','#8A5A33','#5E3B20'),
 'stone':('#C9C6BF','#A8A49B','#7E7A72'),
 'snow':('#FFFFFF','#EEF2F5','#CFD8DE'),
 'foliage':('#7CC25A','#5A9E44','#3F7A32'),
 'sand':('#F2DDA4','#E3C887','#C4A86A'),
 'shallow':('#8FE3E8','#5FD0D8','#3BB0BC'),
 'ocean':('#3D8FE0','#2A6FC4','#1C4F98'),
 'ice':('#9EE7F5','#5CC3E6','#6A5BD8'),
 'gold':('#F7D57A','#F2C14E','#C99A2E'),
 'red':('#E8635D','#D64541','#A8322F'),
 'horse':('#B98A5E','#9C6E45','#74502F'),
 'bone':('#F3EAD6','#E2D3B4','#BFAE8C'),
 'walnut':('#9A6A42','#7A4E2D','#5A3820'),
}
ALL = {c for t in PAL.values() for c in t}
VIEW = (1,1,2)
L = (-0.4,0.8,1.2)
_ln = math.sqrt(sum(x*x for x in L)); L = tuple(x/_ln for x in L)

def r5(x): return round(x*2)/2
def P(p):
    u,v,z = p
    return (r5(48+2*(u-v)), r5(40+u+v-z))
def sub(a,b): return tuple(x-y for x,y in zip(a,b))
def dot(a,b): return sum(x*y for x,y in zip(a,b))
def cross(a,b): return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])
def norm(a):
    n = math.sqrt(dot(a,a)); return tuple(x/n for x in a)

def hull3(pts, eps=1e-6):
    pts=[tuple(map(float,p)) for p in pts]
    faces={}
    n=len(pts)
    for i,j,k in itertools.combinations(range(n),3):
        nn=cross(sub(pts[j],pts[i]),sub(pts[k],pts[i]))
        if dot(nn,nn)<1e-9: continue
        nn=norm(nn)
        s=[dot(sub(p,pts[i]),nn) for p in pts]
        if all(x<=eps for x in s): pass
        elif all(x>=-eps for x in s): nn=tuple(-x for x in nn)
        else: continue
        d=dot(nn,pts[i])
        key=(round(nn[0],4),round(nn[1],4),round(nn[2],4),round(d,3))
        if key in faces: continue
        on=[p for p in pts if abs(dot(p,nn)-d)<1e-4]
        c=tuple(sum(x)/len(on) for x in zip(*on))
        a=norm(sub(on[0],c)); b=cross(nn,a)
        on=sorted(set(on), key=lambda p: math.atan2(dot(sub(p,c),b),dot(sub(p,c),a)))
        faces[key]=(nn,on)
    return list(faces.values())

def tone(n, th=(0.62,0.3)):
    b=dot(n,L)
    return 0 if b>=th[0] else (1 if b>=th[1] else 2)

def hull2(pts):
    pts=sorted(set(pts))
    if len(pts)<3: return pts
    def cr(o,a,b): return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
    lo=[];up=[]
    for p in pts:
        while len(lo)>=2 and cr(lo[-2],lo[-1],p)<=0: lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up)>=2 and cr(up[-2],up[-1],p)<=0: up.pop()
        up.append(p)
    return lo[:-1]+up[:-1]

def area2(pp):
    return abs(sum(pp[i][0]*pp[(i+1)%len(pp)][1]-pp[(i+1)%len(pp)][0]*pp[i][1] for i in range(len(pp))))/2

def solid(pts, mat, th=(0.62,0.3), underlay=True, shift=0, tones=None):
    """convex solid -> list of (screen pts, color). shift: tone offset (+1 darker)."""
    pal=PAL[mat]; out=[]
    fs=[f for f in hull3(pts) if dot(f[0],VIEW)>1e-6]
    fs.sort(key=lambda f: dot(tuple(sum(x)/len(f[1]) for x in zip(*f[1])),VIEW))
    if underlay:
        out.append((hull2([P(p) for p in pts]), pal[min(2,1+max(0,shift))]))
    for nn,vs in fs:
        sp=[P(p) for p in vs]
        # drop duplicate consecutive
        q=[]
        for s in sp:
            if not q or q[-1]!=s: q.append(s)
        if len(q)>1 and q[0]==q[-1]: q.pop()
        if len(q)<3 or area2(q)<0.25: continue
        t=tone(nn,th)
        if tones: t=tones(nn,t)
        t=max(0,min(2,t+shift))
        out.append((q,pal[t]))
    return out

def box(u,v,z,a,b,h): return [(u+i*a,v+j*b,z+k*h) for i in (0,1) for j in (0,1) for k in (0,1)]
def ngon(cu,cv,r,n,z,rot=0,ru=None):
    ru=ru if ru is not None else r
    return [(cu+ru*math.cos(rot+2*math.pi*i/n), cv+r*math.sin(rot+2*math.pi*i/n), z) for i in range(n)]

def fmt(x): return ('%g'%x)
def svg(items):
    lines=['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 72" width="96" height="72">']
    count=0
    for comment,polys in items:
        lines.append('  <!-- %s -->'%comment)
        for pts,col in polys:
            assert col in ALL, col
            for x,y in pts: assert 0<=x<=96 and 0<=y<=64, (comment,x,y)
            lines.append('  <polygon points="%s" fill="%s"/>'%(' '.join('%s,%s'%(fmt(x),fmt(y)) for x,y in pts),col))
            count+=1
    lines.append('</svg>')
    return '\n'.join(lines)+'\n', count
def flat(pts2, col): return [(list(pts2),col)]
