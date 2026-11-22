import { describe, expect, it } from "vitest";
import { globalRule, type SignalData, type VoiceRule } from "@games/webrtc";
import {
  CANDIDATE_BATCH_MS,
  DISCONNECTED_GRACE_MS,
  ICE_NEAR_EXPIRY_MS,
  RESTART_BACKOFF_MS,
} from "../../src/voice/mesh.ts";
import { FakeNet, FakeTrack, fakeState, flush, last, type Node } from "./fake-rtc.ts";

const rule = (hear: string[], sendTo: string[], canTalk = true): VoiceRule => ({ canTalk, hear, sendTo, label: "" });

async function pair(opts: Parameters<FakeNet["add"]>[1] = {}) {
  const net = new FakeNet();
  const a = net.add("a", opts);
  const b = net.add("b");
  a.mesh.setPeers(["b"]);
  await flush();
  b.mesh.setPeers(["a"]);
  await flush();
  return { net, a, b };
}

function pc(node: Node, i = 0) {
  const p = node.pcs[i];
  if (!p) throw new Error(`no pc ${i} on ${node.id}`);
  return p;
}

function signalsFrom(net: FakeNet, from: string, kind: SignalData["kind"]) {
  return net.sent.filter((m) => m.from === from && m.data.kind === kind);
}

describe("MeshTransport", () => {
  it("two peers connect and each plays the other", async () => {
    const { a, b } = await pair();
    expect(pc(a).connectionState).toBe("connected");
    expect(pc(b).connectionState).toBe("connected");
    expect(a.playback.count("attach", "b")).toBe(1);
    expect(b.playback.count("attach", "a")).toBe(1);
    expect(last(a.states)).toEqual({ peer: "b", state: "connected" });
    expect(last(b.states)).toEqual({ peer: "a", state: "connected" });
    // One sendrecv transceiver, with no track, and no more.
    expect(pc(a).transceivers.map((t) => t.direction)).toEqual(["sendrecv"]);
    expect(pc(a).sentTrack()).toBeNull();
  });

  it("simultaneous offers settle with the lower id polite", async () => {
    const net = new FakeNet();
    const a = net.add("a");
    const b = net.add("b");
    a.mesh.setPeers(["b"]);
    b.mesh.setPeers(["a"]);
    await flush();
    expect(pc(a).connectionState).toBe("connected");
    expect(pc(b).connectionState).toBe("connected");
    expect(pc(a).rollbacks).toBe(1); // a is polite and gave way
    expect(pc(b).rollbacks).toBe(0); // b is impolite and ignored a's offer
    expect(a.pcs).toHaveLength(1);
    expect(b.pcs).toHaveLength(1);
  });

  it("candidates before the remote description are queued and added in order", async () => {
    const net = new FakeNet();
    const a = net.add("a");
    const c1 = { candidate: "c1", sdpMid: "0", sdpMLineIndex: 0 };
    const c2 = { candidate: "c2", sdpMid: "0", sdpMLineIndex: 0 };
    const c3 = { candidate: "c3", sdpMid: "0", sdpMLineIndex: 0 };
    a.mesh.handleSignal("b", "sb.0", { kind: "ice", toSession: null, candidates: [c1, c2] });
    a.mesh.handleSignal("b", "sb.0", { kind: "ice", toSession: null, candidates: [c3] });
    await flush();
    expect(pc(a).added).toEqual([]);
    a.mesh.handleSignal("b", "sb.0", { kind: "sdp", toSession: null, description: { type: "offer", sdp: "offer:99:1" } });
    await flush();
    expect(pc(a).remoteSet).toEqual([{ type: "offer", sdp: "offer:99:1" }]);
    expect(pc(a).added.map((c) => c.candidate)).toEqual(["c1", "c2", "c3"]);
    // And it answered, bound to b's session.
    const answer = last(signalsFrom(net, "a", "sdp"));
    expect(answer.data).toMatchObject({ toSession: "sb.0", description: { type: "answer" } });
    expect(answer.session).toBe("sa.0");
  });

  it("sends candidates in batches every 100 ms", async () => {
    const { net, a, b } = await pair();
    expect(CANDIDATE_BATCH_MS).toBe(100);
    pc(a).emitCandidate({ candidate: "x1", sdpMid: "0" });
    await net.clock.advance(25);
    pc(a).emitCandidate({ candidate: "x2", sdpMid: "0" });
    await net.clock.advance(25);
    pc(a).emitCandidate({ candidate: "x3", sdpMid: "0" });
    await net.clock.advance(49);
    expect(signalsFrom(net, "a", "ice")).toHaveLength(0);
    await net.clock.advance(1);
    const ice = signalsFrom(net, "a", "ice");
    expect(ice).toHaveLength(1);
    expect(ice[0]?.data).toEqual({
      kind: "ice",
      toSession: "sb.0",
      candidates: [
        { candidate: "x1", sdpMid: "0" },
        { candidate: "x2", sdpMid: "0" },
        { candidate: "x3", sdpMid: "0" },
      ],
    });
    // The far side added all three.
    await flush();
    expect(pc(b).added.map((c) => c.candidate)).toEqual(["x1", "x2", "x3"]);
  });

  it("publishing is replaceTrack on each sender, with no new offer", async () => {
    const net = new FakeNet();
    const a = net.add("a");
    const b = net.add("b");
    const c = net.add("c");
    a.mesh.setPeers(["b", "c"]);
    b.mesh.setPeers(["a"]);
    c.mesh.setPeers(["a"]);
    await flush();
    const offers = a.pcs.map((p) => p.offers);
    a.mesh.applyPolicy(globalRule("a", ["a", "b", "c"]));
    const track = new FakeTrack("t1");
    await a.mesh.setPublishing(track.asTrack());
    await flush();
    expect(a.pcs.map((p) => p.sentTrack())).toEqual(["t1", "t1"]);
    expect(a.pcs.map((p) => p.offers)).toEqual(offers);
    await a.mesh.setPublishing(null);
    expect(a.pcs.map((p) => p.sentTrack())).toEqual([null, null]);
    await flush();
    expect(a.pcs.map((p) => p.offers)).toEqual(offers);
    expect(a.pcs.every((p) => p.transceivers.length === 1)).toBe(true);
  });

  it("a rule turns sending and playing off and on without renegotiation, removals first", async () => {
    const net = new FakeNet();
    const a = net.add("a");
    const others = ["b", "c", "d"].map((id) => net.add(id));
    a.mesh.setPeers(["b", "c", "d"]);
    for (const o of others) o.mesh.setPeers(["a"]);
    await flush();
    expect(a.pcs.every((p) => p.connectionState === "connected")).toBe(true);
    await a.mesh.setPublishing(new FakeTrack("t").asTrack());
    a.mesh.applyPolicy(rule(["d"], ["d"]));
    await flush();
    const offers = a.pcs.map((p) => p.offers);
    const mark = net.log.length;

    a.mesh.applyPolicy(rule(["b"], ["b", "c"]));
    await flush();
    const steps = net.log
      .slice(mark)
      .filter((e) => e.owner === "a")
      .map((e) => (e.op === "replaceTrack" ? `send ${e.pc.remoteOwner} ${e.track}` : `play ${e.peer} ${e.allowed}`));
    expect(steps).toEqual(expect.arrayContaining(["send d null", "play d false", "send b t", "send c t", "play b true"]));
    expect(steps).toHaveLength(5);
    const lastOff = Math.max(steps.indexOf("send d null"), steps.indexOf("play d false"));
    const firstOn = Math.min(steps.indexOf("send b t"), steps.indexOf("send c t"), steps.indexOf("play b true"));
    expect(lastOff).toBeLessThan(firstOn);
    expect(a.pcs.map((p) => p.offers)).toEqual(offers);

    // canTalk false stops all sending but keeps hearing.
    a.mesh.applyPolicy(rule(["b"], ["b", "c"], false));
    await flush();
    expect(a.pcs.map((p) => p.sentTrack())).toEqual([null, null, null]);
    expect(a.playback.calls.filter((c) => c.op === "setAllowed" && c.peer === "b").at(-1)).toMatchObject({ allowed: true });
  });

  it("fails closed for a peer that is not connected yet", async () => {
    const net = new FakeNet();
    const a = net.add("a");
    const b = net.add("b");
    net.hold();
    a.mesh.setPeers(["b"]);
    b.mesh.setPeers(["a"]);
    await flush();
    a.mesh.applyPolicy(globalRule("a", ["a", "b"]));
    await a.mesh.setPublishing(new FakeTrack("t").asTrack());
    await flush();
    expect(pc(a).sentTrack()).toBeNull();
    expect(a.playback.calls.some((c) => c.op === "setAllowed" && c.allowed)).toBe(false);
    net.release();
    await flush();
    expect(pc(a).connectionState).toBe("connected");
    expect(pc(a).sentTrack()).toBe("t");
    expect(a.playback.calls.filter((c) => c.op === "setAllowed" && c.allowed)).toEqual([
      { op: "setAllowed", peer: "b", allowed: true },
    ]);

    // Dropping out of "connected" turns both off again.
    fakeState(pc(a), "disconnected");
    await flush();
    expect(pc(a).sentTrack()).toBeNull();
    expect(a.playback.calls.at(-1)).toEqual({ op: "setAllowed", peer: "b", allowed: false });
  });

  it("a new session from a peer rebuilds the link and drops the old session's signals", async () => {
    const { net, a, b } = await pair();
    b.mesh.disconnect();
    const b2 = net.add("b", { session: "sb2" });
    b2.mesh.setPeers(["a"]);
    await flush();
    expect(a.pcs).toHaveLength(2);
    expect(pc(a, 0).closed).toBe(true);
    expect(a.playback.count("detach", "b")).toBe(1);
    expect(a.playback.count("attach", "b")).toBe(2);
    expect(pc(a, 1).connectionState).toBe("connected");
    expect(pc(a, 1).remoteOwner).toBe("b");
    // a's own link session stays the same: only b started over.
    expect(last(signalsFrom(net, "a", "sdp")).session).toBe("sa.0");

    const before = pc(a, 1).remoteSet.length;
    a.mesh.handleSignal("b", "sb.0", { kind: "sdp", toSession: null, description: { type: "offer", sdp: "offer:99:9" } });
    a.mesh.handleSignal("b", "sb.0", { kind: "ice", toSession: "sa.0", candidates: [{ candidate: "old" }] });
    await flush();
    expect(a.pcs).toHaveLength(2);
    expect(pc(a, 1).remoteSet).toHaveLength(before);
    expect(pc(a, 1).added).toEqual([]);
    expect(pc(a, 1).connectionState).toBe("connected");
  });

  it("signals for my old session are dropped", async () => {
    const { net, a } = await pair();
    net.hold();
    fakeState(pc(a), "failed");
    await net.clock.advance(RESTART_BACKOFF_MS.reduce((x, y) => x + y, 0) + last(RESTART_BACKOFF_MS));
    expect(a.pcs).toHaveLength(2);
    expect(net.held.some((m) => m.from === "a" && m.session === "sa.1")).toBe(true);

    expect(() =>
      a.mesh.handleSignal("b", "sb.0", { kind: "sdp", toSession: "sa.0", description: { type: "answer", sdp: "answer:2:5" } }),
    ).not.toThrow();
    await flush();
    expect(pc(a, 1).remoteSet).toEqual([]);
    expect(a.pcs).toHaveLength(2);

    // Letting the held signals through, the new link still connects.
    net.release();
    await flush();
    expect(pc(a, 1).connectionState).toBe("connected");
    expect(last(a.states)).toEqual({ peer: "b", state: "connected" });
  });

  it("closes the link to a peer that left voice", async () => {
    const { a } = await pair();
    a.mesh.setPeers([]);
    expect(pc(a).closed).toBe(true);
    expect(a.playback.count("detach", "b")).toBe(1);
    expect(last(a.states)).toEqual({ peer: "b", state: "closed" });
    // A late signal with my old session does not open a new link.
    a.mesh.handleSignal("b", "sb.0", { kind: "ice", toSession: "sa.0", candidates: [{ candidate: "late" }] });
    await flush();
    expect(a.pcs).toHaveLength(1);
  });

  it("restarts ICE with backoff, then rebuilds with a new link session", async () => {
    const { net, a } = await pair({ session: "s" });
    expect(RESTART_BACKOFF_MS).toEqual([1_000, 2_000, 4_000, 8_000]);
    net.hold();
    fakeState(pc(a), "failed");
    await flush();
    expect(last(a.states)).toEqual({ peer: "b", state: "reconnecting" });
    const restarts: number[] = [];
    for (const wait of RESTART_BACKOFF_MS) {
      await net.clock.advance(wait - 1);
      restarts.push(pc(a).restarts);
      await net.clock.advance(1);
      restarts.push(pc(a).restarts);
    }
    expect(restarts).toEqual([0, 1, 1, 2, 2, 3, 3, 4]);
    expect(a.pcs).toHaveLength(1);
    await net.clock.advance(last(RESTART_BACKOFF_MS));
    expect(a.pcs).toHaveLength(2);
    expect(pc(a, 0).closed).toBe(true);
    expect(a.playback.count("detach", "b")).toBe(1);
    const offer = last(net.held.filter((m) => m.from === "a"));
    expect(offer.session).toBe("s.1");
    expect(offer.data).toMatchObject({ kind: "sdp", toSession: "sb.0", description: { type: "offer" } });
  });

  it("a connection back before the next try stops the restarts", async () => {
    const { net, a } = await pair();
    fakeState(pc(a), "failed");
    await net.clock.advance(RESTART_BACKOFF_MS[0]!);
    // The restart renegotiated and the fake connected again.
    expect(pc(a).restarts).toBe(1);
    expect(pc(a).connectionState).toBe("connected");
    await net.clock.advance(60_000);
    expect(pc(a).restarts).toBe(1);
    expect(a.pcs).toHaveLength(1);
  });

  it("counts disconnected for the grace time as failed", async () => {
    const { net, a } = await pair();
    expect(DISCONNECTED_GRACE_MS).toBe(3_000);
    net.hold();
    fakeState(pc(a), "disconnected");
    await net.clock.advance(DISCONNECTED_GRACE_MS + RESTART_BACKOFF_MS[0]! - 1);
    expect(pc(a).restarts).toBe(0);
    await net.clock.advance(1);
    expect(pc(a).restarts).toBe(1);
  });

  it("a short disconnect does not restart", async () => {
    const { net, a } = await pair();
    fakeState(pc(a), "disconnected");
    await net.clock.advance(DISCONNECTED_GRACE_MS - 1);
    fakeState(pc(a), "connected");
    await net.clock.advance(60_000);
    expect(pc(a).restarts).toBe(0);
  });

  it("a bad remote description takes the restart path, never a throw", async () => {
    const { net, a } = await pair();
    net.hold();
    pc(a).failNextRemote = true;
    a.mesh.handleSignal("b", "sb.0", { kind: "sdp", toSession: "sa.0", description: { type: "offer", sdp: "offer:2:9" } });
    await flush();
    expect(last(a.states)).toEqual({ peer: "b", state: "reconnecting" });
    await net.clock.advance(RESTART_BACKOFF_MS[0]!);
    expect(pc(a).restarts).toBe(1);
  });

  it("asks for new ICE servers before a restart near expiry", async () => {
    expect(ICE_NEAR_EXPIRY_MS).toBe(600_000);
    const { net, a } = await pair({ iceExpiresAt: 5 * 60_000 });
    let resolve = () => {};
    a.onRefresh = () => new Promise<void>((r) => (resolve = r));
    net.hold();
    fakeState(pc(a), "failed");
    await net.clock.advance(RESTART_BACKOFF_MS[0]!);
    expect(a.refreshes).toBe(1);
    expect(pc(a).restarts).toBe(0);
    a.mesh.setIceServers([{ urls: "turn:new" }], 2 * 60 * 60_000);
    expect(last(pc(a).configs)).toEqual({ iceServers: [{ urls: "turn:new" }], iceTransportPolicy: "all" });
    resolve();
    await flush();
    expect(pc(a).restarts).toBe(1);
    // Fresh servers now: the next try does not ask again.
    await net.clock.advance(RESTART_BACKOFF_MS[1]!);
    expect(pc(a).restarts).toBe(2);
    expect(a.refreshes).toBe(1);
  });

  it("does not ask for ICE servers when they are far from expiry", async () => {
    const { net, a } = await pair({ iceExpiresAt: 60 * 60_000 });
    net.hold();
    fakeState(pc(a), "failed");
    await net.clock.advance(RESTART_BACKOFF_MS[0]!);
    expect(a.refreshes).toBe(0);
    expect(pc(a).restarts).toBe(1);
  });

  it("relay only sets iceTransportPolicy relay", async () => {
    const servers = [{ urls: "turn:x", username: "u", credential: "p" }];
    const { a, b } = await pair({ relayOnly: true, iceServers: servers });
    expect(pc(a).config).toEqual({ iceServers: servers, iceTransportPolicy: "relay" });
    expect(pc(b).config).toEqual({ iceServers: [], iceTransportPolicy: "all" });
  });

  it("passes gain to playback and reads stats", async () => {
    const { a } = await pair();
    a.mesh.setRemoteGain("b", 0.5);
    expect(last(a.playback.calls)).toEqual({ op: "setGain", peer: "b", gain: 0.5 });
    pc(a).stats = new Map<string, Record<string, unknown>>([
      ["T", { id: "T", type: "transport", selectedCandidatePairId: "P" }],
      ["P", { id: "P", type: "candidate-pair", localCandidateId: "L", currentRoundTripTime: 0.0425 }],
      ["L", { id: "L", type: "local-candidate", candidateType: "relay" }],
      ["I", { id: "I", type: "inbound-rtp", kind: "audio", packetsLost: 7 }],
    ]);
    expect(await a.mesh.getStats()).toEqual([{ peerId: "b", rttMs: 43, packetsLost: 7, relayed: true }]);
    pc(a).stats = new Map();
    expect(await a.mesh.getStats()).toEqual([{ peerId: "b", rttMs: null, packetsLost: null, relayed: null }]);
  });

  it("ignores signals it cannot read", async () => {
    const { a } = await pair();
    for (const bad of [null, 5, "x", { kind: "sdp" }, { kind: "ice", toSession: null, candidates: "no" }, { kind: "zap" }]) {
      expect(() => a.mesh.handleSignal("b", "sb.0", bad)).not.toThrow();
    }
    await flush();
    expect(pc(a).connectionState).toBe("connected");
    expect(a.pcs).toHaveLength(1);
  });

  it("disconnect closes every link and detaches every stream", async () => {
    const net = new FakeNet();
    const a = net.add("a");
    const b = net.add("b");
    const c = net.add("c");
    a.mesh.setPeers(["b", "c"]);
    b.mesh.setPeers(["a"]);
    c.mesh.setPeers(["a"]);
    await flush();
    pc(a).emitCandidate({ candidate: "pending" });
    fakeState(pc(a, 1), "failed");
    a.mesh.disconnect();
    expect(a.pcs.every((p) => p.closed)).toBe(true);
    expect(a.playback.count("detach", "b")).toBe(1);
    expect(a.playback.count("detach", "c")).toBe(1);
    expect(net.clock.pending()).toBe(0);
    const sent = net.sent.length;
    a.mesh.setPeers(["b", "c", "d"]);
    a.mesh.handleSignal("d", "sd.0", { kind: "sdp", toSession: null, description: { type: "offer", sdp: "offer:9:1" } });
    a.mesh.applyPolicy(globalRule("a", ["a", "b"]));
    await a.mesh.setPublishing(new FakeTrack("t").asTrack());
    await net.clock.advance(60_000);
    expect(a.pcs).toHaveLength(2);
    expect(net.sent.length).toBe(sent);
  });
});
