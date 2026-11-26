# Bold card faces for Overheat and Not My Problem! (short design)

**Why:** cards in both games are boxes with text. Players read a name and a line before they know what a card does. A bold face (flat colour, one big SVG icon, the name) says it at a glance on a phone. The user compared printed and bold mockups (`docs/superpowers/mockups/card-designs.html`) and picked bold for these two games.

**Goals:** every Overheat and Not My Problem! card face uses the bold style from the mockup. That covers number cards, power cards, action cards and Problems, wherever they show: hand, row, table, reveal and animation ghosts.

**Non-goals:** the normal 52-card deck used by the other 8 games stays exactly as it is ("perfect already"). No rule, text or layout changes beyond the card face. No shared card package (two games, different cards).

**Anti-goals:** colour must never be the only sign of what a card is. Every face keeps its icon and name, and Overheat number cards keep their shape. The rule text must not become unreadable where it is shown today.

## Approaches

1. **Bold (picked).** Flat colour by what the card does, a big icon, the name. This is the user's choice from the mockups.
2. **Printed.** Paper frame with a title banner, a drawn picture and the rule text. The user didn't pick it for these games.

## Design (from the mockup)

- **Overheat number cards:** the card's colour fills the whole card, with a big number and the colour's shape in two corners. Amber uses dark ink; the others use white. The red circle, amber triangle, blue square and green diamond stay.
- **Overheat power cards:** the colour says what the card does.
  - Blue for "helps you": Cool, Double.
  - Red for "hits a player": Push, Swap, Burn, Steal, Dump, Audit.
  - Amber for "hits everyone": Limit down.
  - Violet for "keeps you safe": Block.
  - Each card shows a big icon and the name.
  - In "Your cards" the rule line and any "can't play" reason stay as text beside the card, as today.
- **Not My Problem! action cards:** the colour says when you play the card.
  - Green answers a Problem: Quick Fix, Fake Report.
  - Amber passes a Problem: Blame Game.
  - Violet is played when a Problem comes to you: Not Me, Revenge, HR Complaint.
  - Blue is played on your turn: Overtime, Intern, Promotion, Spy.
  - Each card shows an icon and the name. Its line stays on the card, since hand cards are about 110 px wide.
- **Not My Problem! Problems:** red, with an icon, the name, the line, and the warnings as dots.
- **What stays:** card backs, face-down cards, and the states (playable, picked, greyed out, focus). Selection outlines stay visible on every colour.
- **Icons:** inline SVG, one for each card kind, drawn as in the mockup: 10 for Overheat and 13 for Not My Problem!.

## Left to the builder

Exact sizes inside each game's current layout, where the icons live (one `icons.ts` per game), and contrast tweaks for small text on each colour (aim for 4.5:1).

## Testing

- The client tests keep passing, and they check that each face has its icon, its name and an aria label.
- A check in Chrome at 360 px wide and sideways for both games.
- `docs/games/*.md` "On your screen" parts get updated if they describe the card look.
