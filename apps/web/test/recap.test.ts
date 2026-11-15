import type { Recap } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { durationText, recapMeta, recapShareText, shareMode } from "../src/views/recap.ts";

const recap = (over: Partial<Recap> = {}): Recap => ({ gamesPlayed: 3, minutes: 80, topGameId: "cheat", awards: [], quiet: null, ...over });
const name = (id: string) => ({ cheat: "Cheat", imposter: "Imposter" })[id] ?? id;

describe("the recap screen's words", () => {
  it("writes the time in minutes, then hours", () => {
    expect(durationText(0)).toBe("Less than 1 min");
    expect(durationText(45)).toBe("45 min");
    expect(durationText(60)).toBe("1 hr");
    expect(durationText(80)).toBe("1 hr 20 min");
  });

  it("joins games, time and the most played game", () => {
    expect(recapMeta(recap(), name)).toBe("3 games · 1 hr 20 min · Most played: Cheat");
    expect(recapMeta(recap({ gamesPlayed: 1, minutes: 12, topGameId: null }), name)).toBe("1 game · 12 min");
  });

  it("shares the awards with the site", () => {
    const r = recap({
      awards: [
        { id: "liar", title: "Biggest liar", who: ["Sam"], line: "Told 9 lies." },
        { id: "eye", title: "Sharpest eye", who: ["Mei", "Arjun"], line: "Called 3 bluffs right." },
      ],
    });
    expect(recapShareText(r, "CouchParty", "couchpartygames.com")).toBe(
      "CouchParty recap: Biggest liar: Sam. Sharpest eye: Mei and Arjun. Play at couchpartygames.com",
    );
  });

  it("shares a quiet night too", () => {
    expect(recapShareText(recap({ gamesPlayed: 2 }), "Party Games", "example.com")).toBe(
      "Party Games recap: 2 games tonight. Play at example.com",
    );
  });
});

describe("how the share button shares", () => {
  const env = { canShareFiles: false, hasShare: false, coarse: false, hasClipboardItem: false };
  it("shares the picture when files can be shared", () => {
    expect(shareMode({ ...env, canShareFiles: true, hasShare: true, coarse: true })).toBe("files");
    expect(shareMode({ ...env, canShareFiles: true })).toBe("files");
  });
  it("shares text on a phone that cannot share files", () => {
    expect(shareMode({ ...env, hasShare: true, coarse: true, hasClipboardItem: true })).toBe("text");
  });
  it("copies picture and text on desktop", () => {
    expect(shareMode({ ...env, hasClipboardItem: true })).toBe("copy-image");
    expect(shareMode({ ...env, hasShare: true, hasClipboardItem: true })).toBe("copy-image");
  });
  it("copies text when the picture cannot be copied", () => {
    expect(shareMode(env)).toBe("copy-text");
    expect(shareMode({ ...env, hasShare: true })).toBe("copy-text");
  });
});
