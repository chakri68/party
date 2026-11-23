import { describe, expect, it } from "vitest";
import { lockGame } from "../src/views/pause.ts";

type Kid = { inert: boolean };
const host = (...children: Kid[]) => ({ children }) as unknown as Element;

describe("pause lock", () => {
  it("makes everything but the cover inert, including a view that mounted after it", () => {
    const cover = { inert: false };
    const late = { inert: false };
    lockGame(host(cover, late), cover as unknown as Element);
    expect(cover.inert).toBe(false);
    expect(late.inert).toBe(true);
  });

  it("lets go of everything once the cover is gone", () => {
    const view = { inert: true };
    lockGame(host(view), null);
    expect(view.inert).toBe(false);
  });
});
