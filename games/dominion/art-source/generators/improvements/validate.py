"""usage: python3 -I validate.py <svg files...>"""
import sys, re, xml.etree.ElementTree as ET
PAL = set('''#8BC34A #6BAA3E #4E8A34 #9A6A42 #8A5A33 #5E3B20 #C9C6BF #A8A49B #7E7A72 #FFFFFF #EEF2F5 #CFD8DE #7CC25A #5A9E44 #3F7A32
#F2DDA4 #E3C887 #C4A86A #8FE3E8 #5FD0D8 #3BB0BC #3D8FE0 #2A6FC4 #1C4F98 #2B8E9A #1E6C78 #173F7C #112F5E #9EE7F5 #5CC3E6 #6A5BD8
#F7D57A #F2C14E #C99A2E #7A4E2D #5A3820'''.split())
bad = 0
for f in sys.argv[1:]:
    txt = open(f).read()
    for w in ('stroke', 'gradient', 'filter', 'opacity', '<style', 'class='):
        if w in txt: print(f, 'FORBIDDEN', w); bad += 1
    root = ET.fromstring(txt)
    assert root.get('viewBox') == '0 0 96 72' and root.get('width') == '96' and root.get('height') == '72', f
    road = '/road.' in f
    n = 0
    for p in root.iter('{http://www.w3.org/2000/svg}polygon'):
        n += 1
        if p.get('fill') not in PAL: print(f, 'COLOR', p.get('fill')); bad += 1
        for xy in p.get('points').split():
            x, y = map(float, xy.split(','))
            if (x * 2) % 1 or (y * 2) % 1: print(f, 'NONHALF', xy); bad += 1
            if y > 64 or x < 0 or x > 96 or y < 0: print(f, 'OUTSIDE', xy); bad += 1
            if not road and (y > 40 + x / 2 + 1e-9 or y > 88 - x / 2 + 1e-9): print(f, 'BELOW-EDGE', xy); bad += 1
    print(f.split('/')[-1], n, 'polygons')
print('problems:', bad)
