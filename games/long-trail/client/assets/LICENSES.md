# Third-party assets

| Pack | Author | Source | License | Version |
| --- | --- | --- | --- | --- |
| Background Elements Remastered (was "Redux") | Kenney (kenney.nl) | https://www.kenney.nl/assets/background-elements-redux | CC0 1.0 | 1.0 |

CC0 means credit isn't required. It's given anyway.

## Files used

**Background Elements Remastered** → `kenney/`, copied as they are, with Kenney's file names. The far layers come pale blue. `scene/art.ts` tints each one once, at load, into the colour of the land.

| File | From the pack's | Used for |
| --- | --- | --- |
| `mountains.png` | `Backgrounds/Elements/` | the far layer for mountains |
| `hills.png` | `Backgrounds/Elements/` | the far layer for plains, towns and markets |
| `hillsLarge.png` | `Backgrounds/Elements/` | the far layer for rivers and the end gate |
| `cloud1.png`, `cloud3.png`, `cloud4.png` | `PNG/Default/` | clouds in a day sky |

The desert's far dunes, the near hills, the ground, the path, the water and the props are drawn in code in `scene/backdrop.ts`.

## Our own art

The sprites in `scene/sprites.ts` are our own, drawn in code: camels, travellers, the tent, the fire, market stalls, houses, the gate and riders.
