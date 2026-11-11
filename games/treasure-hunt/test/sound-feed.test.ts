import { describe, expect, it } from "vitest";
import type { BridgeCall } from "../client/godot/bridge.ts";
import { SoundFeed } from "../client/view.ts";

// M5a Task 4: the page tells Godot the sound settings, on ready and on a change.

describe("SoundFeed", () => {
  const setup = (start = { sound: true, volume: 0.8 }) => {
    const sent: BridgeCall[][] = [];
    const settings = { ...start };
    const feed = new SoundFeed((calls) => sent.push(calls), () => settings);
    return { feed, sent, settings };
  };

  it("sends nothing until Godot is ready, then the settings at once", () => {
    const { feed, sent } = setup();
    feed.poll();
    expect(sent).toEqual([]);
    feed.ready();
    expect(sent).toEqual([[{ fn: "sound", arg: { muted: false, volume: 0.8 } }]]);
  });

  it("sends only when sound or volume changes", () => {
    const { feed, sent, settings } = setup();
    feed.ready();
    feed.poll();
    feed.poll();
    expect(sent).toHaveLength(1);
    settings.sound = false;
    feed.poll();
    expect(sent[1]).toEqual([{ fn: "sound", arg: { muted: true, volume: 0.8 } }]);
    settings.volume = 0.3;
    feed.poll();
    expect(sent[2]).toEqual([{ fn: "sound", arg: { muted: true, volume: 0.3 } }]);
    feed.poll();
    expect(sent).toHaveLength(3);
  });

  it("a second ready (the iframe reloaded) sends again", () => {
    const { feed, sent } = setup();
    feed.ready();
    feed.ready();
    expect(sent).toHaveLength(2);
  });
});
