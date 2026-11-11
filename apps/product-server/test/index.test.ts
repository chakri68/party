import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// partyserver imports "cloudflare:workers", which plain Node can't load.
vi.mock("partyserver", () => ({
  Server: class {},
  getServerByName: async () => ({}),
  routePartykitRequest: async () => null,
}));
import worker from "../src/index.ts";
import type { ProductEnv } from "../src/env.ts";

const ORIGIN = "https://couchpartygames.com";
const SHELL = `<!doctype html><html><head><title>CouchParty</title><meta property="og:title" content="CouchParty" /></head><body></body></html>`;

/**
 * Just enough HTMLRewriter for the room preview: rewrites <title> and leaves
 * the rest. Node has no HTMLRewriter; workerd does.
 */
class FakeRewriter {
  private title: string | null = null;
  on(selector: string, handlers: { element?: (el: unknown) => void }) {
    if (selector === "title") handlers.element?.({ setInnerContent: (t: string) => void (this.title = t) });
    return this;
  }
  transform(res: Response): Response {
    const title = this.title;
    const body = res.text().then((t) => (title === null ? t : t.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)));
    return new Response(
      new ReadableStream({
        async start(c) {
          c.enqueue(new TextEncoder().encode(await body));
          c.close();
        },
      }),
      { status: res.status, headers: res.headers },
    );
  }
}

/** Like the real assets binding with html_handling auto-trailing-slash: /play.html is a 307 to /play. */
function fakeAssets() {
  const seen: string[] = [];
  return {
    seen,
    fetch: async (req: Request) => {
      const path = new URL(req.url).pathname;
      seen.push(path);
      if (path.endsWith(".html")) return new Response(null, { status: 307, headers: { location: path.slice(0, -5) } });
      if (path === "/play") return new Response(SHELL, { headers: { "content-type": "text/html" } });
      return new Response("Not Found", { status: 404 });
    },
  };
}

describe("product Worker routing", () => {
  const real = (globalThis as { HTMLRewriter?: unknown }).HTMLRewriter;
  beforeAll(() => void ((globalThis as { HTMLRewriter?: unknown }).HTMLRewriter = FakeRewriter));
  afterAll(() => void ((globalThis as { HTMLRewriter?: unknown }).HTMLRewriter = real));

  it("a room link gets the shell from /play with the room's preview title, not a 307", async () => {
    const assets = fakeAssets();
    const env = { ASSETS: assets, APP_ORIGIN: ORIGIN } as unknown as ProductEnv;
    const r = await worker.fetch(new Request(`${ORIGIN}/room/ABCD`) as never, env);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("<title>Join room ABCD · CouchParty</title>");
    expect(assets.seen).toEqual(["/play"]);
  });
});
