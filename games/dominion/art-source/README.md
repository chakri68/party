# Dominion art source

Not shipped. Production exports go to `../client/assets/` once the manifest exists.

- `svg/` — the classic pack, hand-authored polygons. **`svg/STYLE.md` is the contract**; read it before touching anything. `svg/_exports/` holds 2× PNGs.
- `concepts/` — generated concept art (codex `image_gen`), reference only. `m1-tabletop/` is the rejected first direction, kept for comparison. Provenance is in each folder's `GENERATION_NOTES.md`.
- `concepts/_previews/` — board renders. `svg-scene-*.png` is the current state of the pack.
- `tools/preview_svg_scene.py` — composes a sample board from `svg/` with real anchors, player tinting and the STYLE.md draw order. Run it after any change: `python3 -I tools/preview_svg_scene.py svg concepts/_previews`
- `tools/split_terrain.py` — wraps terrain SVGs into `ground`/`props` groups.
- `tools/preview_scene.py` — the older concept-PNG board preview.
- `generators/` — the scripts the sprite agents used to compute polygon coordinates. The SVGs are the source of truth; these are convenience, and the `check.*` scripts still point at a long-gone scratch dir.
