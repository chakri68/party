import sys, subprocess, os
from PIL import Image
S=os.path.dirname(os.path.abspath(__file__))
A='/home/chakradharreddy/Repos/personal_projects/games/games/dominion/art-source/svg'
def r(svg,w,h,out): subprocess.run(['rsvg-convert','-w',str(w),'-h',str(h),svg,'-o',out],check=True)
ids=sys.argv[1:]
rows=[]
for i in ids:
    fam='features' if i.startswith('feature') else 'resources'
    f=f'{A}/{fam}/{i}.svg'
    base=f'{S}/water.svg' if 'fish' in i else f'{A}/terrain/terrain.plains.default.svg'
    ims=[]
    for k in (1,3):
        r(base,96*k,72*k,f'{S}/b.png'); r(f,96*k,72*k,f'{S}/o.png')
        b=Image.open(f'{S}/b.png').convert('RGBA'); o=Image.open(f'{S}/o.png').convert('RGBA')
        b.alpha_composite(o); ims.append(b)
    # 1x shown upscaled nearest x3 next to the 3x render, plus true 1x
    one=ims[0]; big=ims[1]
    row=Image.new('RGBA',(96+288*2+20,216),(40,40,40,255))
    row.paste(one,(0,0)); row.paste(one.resize((288,216),Image.NEAREST),(106,0)); row.paste(big,(404,0))
    rows.append(row)
sheet=Image.new('RGBA',(rows[0].width,216*len(rows)),(40,40,40,255))
for n,rw in enumerate(rows): sheet.paste(rw,(0,216*n))
sheet.save(f'{S}/sheet.png')
