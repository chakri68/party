import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FOOT_LINKS, PLAY_CREATE_TEXT, PLAY_HOME, PLAY_TITLE } from "../src/header.ts";

const file = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

describe("/play wears the site's chrome", () => {
  it("has the same footer links as the other pages", () => {
    const partial = [...file("partials/footer.html").matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[2], m[1]]);
    expect(FOOT_LINKS).toEqual(partial);
  });

  it("names the start page for search", () => {
    expect(file("play.html")).toContain(`<title>${PLAY_TITLE}</title>`);
  });

  it("gives the shell the start page's heading, line, tab title and button", () => {
    expect(PLAY_HOME).toEqual({
      title: "Start a room",
      subtitle: "Type your name. Then start a new room, or join a friend's room with its code.",
      pageTitle: PLAY_TITLE,
    });
    expect(PLAY_CREATE_TEXT).toBe("Start a room");
    const play = file("src/play.ts");
    expect(play).toMatch(/createText: PLAY_CREATE_TEXT/);
    expect(play).toMatch(/home: PLAY_HOME/);
  });

  it("has the phone menu in the site header, wired to its button", () => {
    const header = file("partials/header.html");
    expect(header).toMatch(/<button class="menu-btn" type="button" aria-expanded="false" aria-controls="site-menu"/);
    expect(header).toMatch(/<div class="site-menu" id="site-menu" hidden>/);
    for (const href of ["/#games", "/pricing", "/account"]) expect(header.match(/<div class="site-menu"[\s\S]*?<\/div>/)![0]).toContain(`href="${href}"`);
  });
});
