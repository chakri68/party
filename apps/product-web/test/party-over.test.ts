import { describe, expect, it } from "vitest";
import { partyOverCopy, whoIsThis } from "../src/party-over.ts";

describe("after the party", () => {
  it("asks a player who joined to host next", () => {
    expect(partyOverCopy("joinee")).toEqual({
      heading: "Your turn to host.",
      body: "Start your own party. It is free, and your friends do not need an app.",
      cta: { label: "Start a room", href: "/play" },
      note: { before: "Want every game and 16 players? ", link: "See Host Pass", href: "/pricing", after: "" },
    });
  });

  it("offers the host a new room and Host Pass", () => {
    expect(partyOverCopy("host")).toEqual({
      cta: { label: "Start a new room", href: "/play" },
      note: { before: "Get ", link: "Host Pass", href: "/pricing", after: " for every game and up to 16 players." },
    });
  });

  it("only a new room for a host who has the pass", () => {
    expect(partyOverCopy("host-pass")).toEqual({ cta: { label: "Start a new room", href: "/play" } });
  });

  it("invites anyone at a closed room to start their own", () => {
    expect(partyOverCopy("closed")).toEqual({
      heading: "This party is over.",
      cta: { label: "Start your own room", href: "/play" },
      note: { before: "It is free. No app needed." },
    });
  });

  it("works out who's looking", () => {
    const recap = { gamesPlayed: 1, minutes: 5, topGameId: null, awards: [], quiet: null };
    expect(whoIsThis({ isHost: false, recap }, "free")).toBe("joinee");
    expect(whoIsThis({ isHost: false, recap }, "pass")).toBe("joinee");
    expect(whoIsThis({ isHost: true, recap }, "free")).toBe("host");
    expect(whoIsThis({ isHost: true, recap }, "pass")).toBe("host-pass");
    expect(whoIsThis({ isHost: true, recap: null }, "pass")).toBe("closed");
  });
});
