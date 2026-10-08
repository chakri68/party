#!/bin/sh
S=/tmp/claude-1000/-home-chakradharreddy-Repos-personal-projects-games/2d85fb7f-4b91-4346-bc35-6a285049287d/scratchpad/svgcheck/terrain2
cd /home/chakradharreddy/Repos/personal_projects/games/games/dominion/art-source/svg/terrain
for f in *.svg; do id=${f%.svg}; w=96; h=72; case $id in terrain.mountain.*) h=104;; esac
 rsvg-convert -w $w -h $h $f -o $S/$id.1x.png
 rsvg-convert -w $((w*4)) -h $((h*4)) $f -o $S/$id.4x.png
done
