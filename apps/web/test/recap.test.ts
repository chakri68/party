import type { Recap } from "@games/game-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { durationText, momentText, recapMeta, recapShareText, recapView, shareButton, shareMode } from "../src/views/recap.ts";

interface Fake {
  tag: string;
  kids: unknown[];
}
vi.mock("@games/ui", () => ({
  h: (tag: string, _attrs: object, ...children: unknown[]) => {
    const handlers: Record<string, () => void> = {};
    const kids = children.flat().filter((c) => c !== null && c !== undefined && c !== false);
    return {
      tag,
      kids,
      append: (...c: unknown[]) => kids.push(...c),
      addEventListener: (e: string, f: () => void) => (handlers[e] = f),
      click: () => handlers.click?.(),
      replaceChildren() {},
      textContent: typeof children[0] === "string" ? children[0] : undefined,
    };
  },
}));
/** Every bit of text in the fake tree, in order. */
const texts = (n: unknown): string[] => (typeof n === "string" ? [n] : ((n as Fake).kids ?? []).flatMap(texts));
vi.mock("../src/brand.ts", () => ({ icon: () => ({}) }));
vi.mock("../src/views/recap-image.ts", () => ({ recapImage: () => new Promise(() => {}) }));

const recap = (over: Partial<Recap> = {}): Recap => ({ gamesPlayed: 3, minutes: 80, topGameId: "cheat", awards: [], table: [], moment: null, quiet: null, ...over });
const name = (id: string) => ({ cheat: "Cheat", imposter: "Imposter", overheat: "Overheat" })[id] ?? id;
const liar = { id: "liar", title: "Biggest liar", who: ["Sam"], line: "Told 9 lies." };
const chatty = { id: "chatty", title: "Most talkative", who: ["Mei"], line: "Talked for 14 minutes." };
const dj = { id: "dj", title: "DJ of the night", who: ["Arjun", "Priya"], line: "Played 31 sounds." };

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

  it("writes the loudest moment, in a game or in the lobby", () => {
    expect(momentText({ count: 5, gameId: "overheat" }, name)).toBe("Loudest moment: 5 people talking at once, in Overheat.");
    expect(momentText({ count: 5, gameId: null }, name)).toBe("Loudest moment: 5 people talking at once, in the lobby.");
  });

  it("shares the table awards after the main ones, without the moment", () => {
    const r = recap({ awards: [liar], table: [chatty, dj], moment: { count: 4, gameId: null } });
    expect(recapShareText(r, "Party", "example.com")).toBe(
      "Party recap: Biggest liar: Sam. Most talkative: Mei. DJ of the night: Arjun and Priya. Play at example.com",
    );
  });

  it("shares table awards alone, not the games count", () => {
    expect(recapShareText(recap({ table: [chatty] }), "Party", "example.com")).toBe("Party recap: Most talkative: Mei. Play at example.com");
  });

  it("shares a quiet night too", () => {
    expect(recapShareText(recap({ gamesPlayed: 2 }), "Party Games", "example.com")).toBe(
      "Party Games recap: 2 games tonight. Play at example.com",
    );
  });
});

describe("the recap screen", () => {
  afterEach(() => vi.unstubAllGlobals());
  const show = (r: Recap) => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.stubGlobal("location", { host: "party.test" });
    vi.stubGlobal("navigator", {});
    return texts(recapView({ recap: r, isHost: true, appTitle: "Party", gameName: name, home: () => {} }));
  };

  it("shows Around the table after the main awards, then the moment", () => {
    const t = show(recap({ awards: [liar], table: [chatty, dj], moment: { count: 5, gameId: "overheat" } }));
    const at = (s: string) => t.indexOf(s);
    expect(at("Biggest liar")).toBeGreaterThan(-1);
    expect(at("Around the table")).toBeGreaterThan(at("Told 9 lies."));
    expect(at("Most talkative")).toBeGreaterThan(at("Around the table"));
    expect(at("DJ of the night")).toBeGreaterThan(at("Most talkative"));
    expect(at("Arjun and Priya")).toBeGreaterThan(-1);
    expect(at("Loudest moment: 5 people talking at once, in Overheat.")).toBeGreaterThan(at("Played 31 sounds."));
  });

  it("has no Around the table heading without table awards", () => {
    const t = show(recap({ awards: [liar] }));
    expect(t).not.toContain("Around the table");
    expect(t.some((s) => s.startsWith("Loudest moment"))).toBe(false);
  });

  it("shows the quiet text, then the moment", () => {
    const t = show(recap({ quiet: "A quiet night.", moment: { count: 3, gameId: null } }));
    expect(t.indexOf("Loudest moment: 3 people talking at once, in the lobby.")).toBeGreaterThan(t.indexOf("A quiet night."));
    expect(t.indexOf("A quiet night.")).toBeGreaterThan(-1);
  });

  it("shows table awards alone, without the quiet text", () => {
    const t = show(recap({ table: [chatty] }));
    expect(t).toContain("Around the table");
    expect(t).toContain("Most talkative");
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
