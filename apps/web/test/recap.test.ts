import type { Recap } from "@games/game-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { durationText, recapMeta, recapShareText, shareButton, shareMode } from "../src/views/recap.ts";

vi.mock("@games/ui", () => ({
  h: (_tag: string, _attrs: object, label: string) => {
    const handlers: Record<string, () => void> = {};
    return { addEventListener: (e: string, f: () => void) => (handlers[e] = f), click: () => handlers.click?.(), replaceChildren() {}, textContent: label };
  },
}));
vi.mock("../src/brand.ts", () => ({ icon: () => ({}) }));
vi.mock("../src/views/recap-image.ts", () => ({ recapImage: () => new Promise(() => {}) }));

const recap = (over: Partial<Recap> = {}): Recap => ({ gamesPlayed: 3, minutes: 80, topGameId: "cheat", awards: [], table: [], moment: null, quiet: null, ...over });
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
  it("shares the picture on a phone that can share files", () => {
    expect(shareMode({ ...env, canShareFiles: true, hasShare: true, coarse: true })).toBe("files");
  });
  it("shares text on a phone that cannot share files", () => {
    expect(shareMode({ ...env, hasShare: true, coarse: true, hasClipboardItem: true })).toBe("text");
  });
  it("never opens the share sheet on desktop", () => {
    expect(shareMode({ ...env, canShareFiles: true, hasShare: true, hasClipboardItem: true })).toBe("copy-image");
    expect(shareMode({ ...env, hasShare: true })).toBe("copy-text");
  });
  it("copies picture and text on desktop, or text only", () => {
    expect(shareMode({ ...env, hasClipboardItem: true })).toBe("copy-image");
    expect(shareMode(env)).toBe("copy-text");
  });
});

describe("the share button keeps the tap", () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (coarse: boolean) => {
    const share = vi.fn(() => new Promise<void>(() => {}));
    const write = vi.fn(() => new Promise<void>(() => {}));
    vi.stubGlobal("matchMedia", () => ({ matches: coarse }));
    vi.stubGlobal("location", { host: "party.test" });
    vi.stubGlobal("ClipboardItem", class {});
    vi.stubGlobal("navigator", { share, canShare: () => true, clipboard: { write, writeText: vi.fn(() => Promise.resolve()) } });
    return { share, write };
  };
  const view = () => shareButton(recap(), { recap: recap(), isHost: true, appTitle: "Party", gameName: name, home: () => {} }) as unknown as { click(): void };

  it("calls share in the same tick, even while the picture is still drawing", () => {
    const { share } = stub(true);
    view().click();
    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0]![0]).toEqual({ text: expect.any(String) });
  });
  it("calls the clipboard in the same tick on desktop", () => {
    const { write } = stub(false);
    view().click();
    expect(write).toHaveBeenCalledTimes(1);
  });
});
