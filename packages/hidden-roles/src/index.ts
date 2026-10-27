// Client-safe kit for hidden-role games. This entry is the deck half (role decks
// as lobby settings), runtime-agnostic so a game's server can parse with it.
// The role card is DOM and lives at "@games/hidden-roles/reveal".
// Nothing here may import a game's `server/`.

export * from "./deck.ts";
