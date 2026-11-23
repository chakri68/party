import { afterEach, describe, expect, it, vi } from "vitest";
import { isSkip, transition } from "../src/transition.ts";

type Fake = { ready: Promise<void>; finished: Promise<void>; updateCallbackDone: Promise<void> };

function fakeDocument(make: (update: () => void) => Fake) {
  const doc = {
    documentElement: { dataset: {} as Record<string, string> },
    visibilityState: "visible",
    querySelector: () => null,
    startViewTransition: (update: () => void) => make(update),
  };
  vi.stubGlobal("document", doc);
  return doc;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("page transitions", () => {
  it("knows the browser's skip from a real error", () => {
    expect(isSkip(new DOMException("Transition was aborted because of invalid state. Viewport size changed", "InvalidStateError"))).toBe(true);
    expect(isSkip(new DOMException("Skipped", "AbortError"))).toBe(true);
    expect(isSkip(new TypeError("boom"))).toBe(false);
  });

  it("swallows a skipped transition: the update still runs and nothing is left unhandled", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    const update = vi.fn();
    const doc = fakeDocument((u) => {
      u();
      const skip = new DOMException("Transition was aborted because of invalid state. Viewport size changed", "InvalidStateError");
      return { ready: Promise.reject(skip), finished: Promise.resolve(), updateCallbackDone: Promise.resolve() };
    });
    transition("phase", update);
    await new Promise((r) => setTimeout(r, 10));
    process.off("unhandledRejection", onUnhandled);
    expect(update).toHaveBeenCalledOnce();
    expect(unhandled).toEqual([]);
    expect(doc.documentElement.dataset.vt).toBeUndefined();
  });
});
