L,M,D="#7CC25A","#5A9E44","#3F7A32"
def P(pts,fill): return '  <polygon points="%s" fill="%s"/>'%(" ".join("%g,%g"%p for p in pts),fill)
def broad(cx,cy,name):
    o=lambda x,y:(cx+x,cy+y)
    N,NE,E,SE,S,SW,W,NW=o(0,-13),o(8,-10),o(12,-2),o(10,6),o(2,11),o(-7,9),o(-12,1),o(-9,-8)
    p,q,r=o(-2,-4),o(4,2),o(-3,5)
    bx,by=cx,cy+18
    out=["  <!-- %s broadleaf, base (%g,%g) -->"%(name,bx,by),
      P([(bx-2,by-8),(bx,by-7),(bx,by+1),(bx-2,by)],"#7A4E2D"),
      P([(bx,by-7),(bx+2,by-8),(bx+2,by),(bx,by+1)],"#5A3820"),
      P([N,NE,E,SE,S,SW,W,NW],M),
      P([N,NW,W,p],L),
      P([p,r,q],L),
      P([NE,E,SE,S,r,q],D),
      P([N,NE,q,p],M)]
    return out
def conifer(bx,by):
    out=["  <!-- front conifer, base (%g,%g) -->"%(bx,by),
      P([(bx-2,by-7),(bx,by-6),(bx,by+1),(bx-2,by)],"#7A4E2D"),
      P([(bx,by-6),(bx+2,by-7),(bx+2,by),(bx,by+1)],"#5A3820")]
    for (top,base,hw,tone) in [(by-20,by-4,10,L),(by-26,by-10,8,M),(by-32,by-16,6,L)]:
        out.append(P([(bx,top),(bx-hw,base-2),(bx+2,base+1)],tone))
        out.append(P([(bx,top),(bx+2,base+1),(bx+hw,base-2)],D))
    return out
hdr='''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 72" width="96" height="72">
  <!-- earth slab -->
  <polygon points="0,40 48,64 48,72 0,48" fill="#8A5A33"/>
  <polygon points="48,64 96,40 96,48 48,72" fill="#5E3B20"/>
  <!-- grass top: full mid diamond underlay, then light up-left and dark right facets -->
  <polygon points="48,16 96,40 48,64 0,40" fill="#6BAA3E"/>
  <polygon points="0,40 48,16 64,24 62,38 26,43" fill="#8BC34A"/>
  <polygon points="64,24 96,40 84,46 62,38" fill="#4E8A34"/>
  <!-- trees back to front by base y, neutral foliage row.
       broadleaf: trunk, mid canopy silhouette underlay, then light cap, light centre, dark right, mid top-right -->'''
lines=[hdr]+broad(30,20,"back-left")+broad(70,27,"right")+conifer(47,55)+["</svg>"]
open("/home/chakradharreddy/Repos/personal_projects/games/games/dominion/art-source/svg/terrain/terrain.forest.v2.svg","w").write("\n".join(lines)+"\n")
