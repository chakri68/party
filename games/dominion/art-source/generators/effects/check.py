import subprocess
from PIL import Image
S='/home/chakradharreddy/Repos/personal_projects/games/games/dominion/art-source/svg'
T='/tmp/claude-1000/-home-chakradharreddy-Repos-personal-projects-games/2d85fb7f-4b91-4346-bc35-6a285049287d/scratchpad/svgcheck/effects'
ids=['hit','heal','capture','spawn','research','discovery']
def r(svg,w,h,out): subprocess.run(['rsvg-convert','-w',str(w),'-h',str(h),svg,'-o',out],check=True); return Image.open(out).convert('RGBA')
def scene(z):
    tile=r(f'{S}/terrain/terrain.plains.default.svg',96*z,72*z,f'{T}/t{z}.png')
    unit=r(f'{S}/units/unit.infantry.orchard.idle.svg',48*z,64*z,f'{T}/u{z}.png')
    c=Image.new('RGBA',(96*z,92*z),(0x2A,0x6F,0xC4,255)); c.alpha_composite(tile,(0,20*z)); c.alpha_composite(unit,(24*z,0)); return c
def flat(col,sz,e): b=Image.new('RGBA',(sz+16,sz+16),col); b.alpha_composite(e,(8,8)); return b
for z,sizes in ((1,(24,32,48)),(3,(96,144))):
    sc=scene(z); tiles=[]
    for i in ids:
        row=[]
        for sz in sizes:
            e=r(f'{S}/effects/effect.{i}.svg',sz,sz,f'{T}/e.png')
            c=sc.copy(); c.alpha_composite(e,((96*z-sz)//2,30*z-sz//2)); row.append(c)
        e=r(f'{S}/effects/effect.{i}.svg',sizes[-1],sizes[-1],f'{T}/e.png')
        row.append(flat((0x2A,0x6F,0xC4,255),sizes[-1],e)); row.append(flat((0x6B,0xAA,0x3E,255),sizes[-1],e))
        tiles.append(row)
    W=max(sum(im.width+4 for im in row) for row in tiles); H=sum(max(im.height for im in row)+4 for row in tiles)
    sh=Image.new('RGBA',(W,H),(30,30,30,255)); y=0
    for row in tiles:
        x=0
        for im in row: sh.alpha_composite(im,(x,y)); x+=im.width+4
        y+=max(im.height for im in row)+4
    if z==1: sh=sh.resize((sh.width*2,sh.height*2),Image.NEAREST)
    sh.save(f'{T}/sheet{z}.png')
