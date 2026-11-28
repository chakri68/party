// The client's pure helpers: the buttons with their prices, the seat tags and the log lines. No page needed.
import type { GameViewProps } from "@games/ui";
import { describe as group, expect, it } from "vitest";
import { describe, moveButtons, seatTag } from "../client/model.ts";
import type { TeenPattiEvent, TeenPattiPublicPlayer } from "../shared/types.ts";

const props = {
  playerId: "p0",
  room: { seats: [{ id: "p0", name: "Asha" }, { id: "p1", name: "Ravi" }, { id: "p2", name: "Meera" }] },
} as unknown as GameViewProps;
const say = (e: TeenPattiEvent) => describe(e, props);

group("buttons", () => {
  it("show the price of every move", () => {
    expect(moveButtons({ chaal: 20, double: 40, allIn: null, show: 20, sideshow: { toId: "p1", cost: 20 } }).map((b) => b.label)).toEqual([
      "Pack",
      "Chaal 20",
      "Double 40",
      "Show 20",
      "Sideshow 20",
    ]);
    expect(moveButtons({ chaal: null, double: null, allIn: 15, show: null, sideshow: null }).map((b) => b.label)).toEqual(["Pack", "All-in 15"]);
  });
});

group("seat tags", () => {
  const p = (o: Partial<TeenPattiPublicPlayer>): TeenPattiPublicPlayer => ({
    id: "p1", stack: 900, inHand: true, packed: false, seen: false, allIn: false, inPot: 10, lastMove: null,
    sittingOut: false, away: false, removed: false, out: false, cards: null, ...o,
  });
  it("say what the player did last, or where they stand", () => {
    expect(seatTag(p({ lastMove: { kind: "double", amount: 1200 } }))).toEqual({ text: "Double 1,200", hot: false });
    expect(seatTag(p({ packed: true }))).toEqual({ text: "Packed", hot: false });
    expect(seatTag(p({ allIn: true }))).toEqual({ text: "All-in", hot: true });
    expect(seatTag(p({ out: true, inHand: false }))).toEqual({ text: "Out", hot: false });
    expect(seatTag(p({}))).toBeNull();
  });
});

group("log lines", () => {
  it("are short and plain", () => {
    expect(say({ type: "bet", playerId: "p1", kind: "chaal", amount: 10, seen: false, stake: 10 })).toBe("Ravi bets 10 Blind.");
    expect(say({ type: "bet", playerId: "p0", kind: "double", amount: 80, seen: true, stake: 40 })).toBe("You double to 80. The stake is now 40.");
    expect(say({ type: "saw", playerId: "p2" })).toBe("Meera sees their cards.");
    expect(say({ type: "saw", playerId: "p0" })).toBeNull();
    expect(say({ type: "sideshow-ask", fromId: "p1", toId: "p0" })).toBe("Ravi asks you for a Sideshow.");
    expect(say({ type: "sideshow-answer", fromId: "p1", toId: "p2", accepted: false, auto: "timer" })).toBe("Meera says no (out of time).");
    expect(say({ type: "pack", playerId: "p2", reason: "sideshow" })).toBe("Meera loses the Sideshow and packs.");
    expect(say({ type: "pot-limit", limit: 2560 })).toBe("The pot reached the limit of 2,560. Every hand turns over.");
    expect(say({ type: "hand-start", handNumber: 2, level: 1, boot: 10, dealerId: "p1", dealt: [], boots: [] })).toBe(
      "Hand 2. Everyone puts in the boot of 10. Ravi deals.",
    );
  });
});
