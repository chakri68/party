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

// Voice phase 3 Task 5: Godot gets the ducked volume, and a duck change at once.

describe("SoundFeed and ducking", () => {
  const setup = (start = { sound: true, volume: 0.245 }) => {
    const sent: BridgeCall[][] = [];
    const settings = { ...start };
    const listeners = new Set<() => void>();
    const onChange = (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    };
    const fire = () => [...listeners].forEach((fn) => fn());
    const feed = new SoundFeed((calls) => sent.push(calls), () => settings, onChange);
    return { feed, sent, settings, listeners, fire };
  };

  it("ready sends the ducked volume", () => {
    const { feed, sent } = setup();
    feed.ready();
    expect(sent).toEqual([[{ fn: "sound", arg: { muted: false, volume: 0.245 } }]]);
  });

  it("a duck change is sent at once", () => {
    const { feed, sent, settings, fire } = setup({ sound: true, volume: 0.7 });
    fire();
    expect(sent).toEqual([]);
    feed.ready();
    settings.volume = 0.245;
    fire();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual([{ fn: "sound", arg: { muted: false, volume: 0.245 } }]);
    fire();
    expect(sent).toHaveLength(2);
  });

  it("destroy stops listening", () => {
    const { feed, sent, settings, listeners, fire } = setup();
    feed.ready();
    expect(listeners.size).toBe(1);
    feed.destroy();
    expect(listeners.size).toBe(0);
    settings.volume = 0.7;
    fire();
    feed.poll();
    expect(sent).toHaveLength(1);
  });
});
