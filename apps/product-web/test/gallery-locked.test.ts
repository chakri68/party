import { describe, expect, it, vi } from "vitest";

// Pretend Cheat is Host Pass only. It has computer players, but a free room can't open it.
vi.mock("@games/product-server/catalog-data", async (orig) => {
  const m = await orig<typeof import("@games/product-server/catalog-data")>();
  return { ...m, PREMIUM_GAME_IDS: [...m.PREMIUM_GAME_IDS, "cheat"] };
});

describe("galleryModel with a locked game that has computers", () => {
  it("gets computers: false", async () => {
    const { galleryModel } = await import("../src/gallery.ts");
    const cheat = galleryModel().flatMap((s) => s.games).find((g) => g.id === "cheat");
    expect(cheat).toMatchObject({ pass: true, computers: false });
  });
});
