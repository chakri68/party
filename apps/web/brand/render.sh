#!/usr/bin/env bash
# Regenerates apps/web/public icons + share image from the SVGs here.
# Needs rsvg-convert and ImageMagick (for the .ico).
set -euo pipefail
cd "$(dirname "$0")"
out=../public
cp mark.svg "$out/favicon.svg"
rsvg-convert -w 180 -h 180 icon.svg -o "$out/apple-touch-icon.png"
rsvg-convert -w 192 -h 192 icon.svg -o "$out/icon-192.png"
rsvg-convert -w 512 -h 512 icon.svg -o "$out/icon-512.png"
rsvg-convert -w 512 -h 512 icon-maskable.svg -o "$out/icon-maskable-512.png"
rsvg-convert -w 1200 -h 630 og.svg -o "$out/og-image.png"
tmp=$(mktemp -d)
rsvg-convert -w 32 -h 32 mark.svg -o "$tmp/32.png"
rsvg-convert -w 16 -h 16 mark.svg -o "$tmp/16.png"
convert "$tmp/16.png" "$tmp/32.png" "$out/favicon.ico"
rm -r "$tmp"
echo "icons written to $out"
