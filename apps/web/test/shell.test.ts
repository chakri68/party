import { dominionManifest } from "@games/dominion/shared";
import { describe, expect, it } from "vitest";
import { games } from "../src/games.ts";
import { configure, overrideGameNames, shellConfig } from "../src/shell.ts";

describe("the shell seam", () => {
  it("defaults to the Party Games setup", () => {
    expect(shellConfig().homePath).toBe("/");
    expect(shellConfig().appTitle).toBe("Party Games");
  });

  it("takes options over the defaults and ignores undefined ones", () => {
    configure({ homePath: "/play", appTitle: undefined });
    expect(shellConfig().homePath).toBe("/play");
    expect(shellConfig().appTitle).toBe("Party Games");
    configure({});
    expect(shellConfig().homePath).toBe("/");
  });

  it("renames a game without touching the shared manifest", () => {
    overrideGameNames({ dominion: "Frontier" });
    expect(games.dominion!.manifest.name).toBe("Frontier");
    expect(dominionManifest.name).toBe("Dominion");
    overrideGameNames({ dominion: "Dominion" });
  });
});
