import { describe, expect, it } from "vitest";
import { hasMySounds, LibraryApi, parseLibrary, SAVE_FAILED } from "../../src/sounds/library.ts";

const slot = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `S${id}`,
  ms: 500,
  url: `/api/sounds/${id}?v=0123456789`,
  ...extra,
});

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("library client", () => {
  it("get sends the auth headers and parses the list", async () => {
    const f = fakeFetch(() => jsonRes({ active: true, slots: [slot("3"), slot("1")] }));
    const api = new LibraryApi({ fetch: f.fn, headers: () => ({ authorization: "Bearer k" }) });
    const lib = await api.get();
    expect(f.calls[0]!.url).toBe("/api/sounds");
    expect(new Headers(f.calls[0]!.init?.headers).get("authorization")).toBe("Bearer k");
    expect(lib?.active).toBe(true);
    expect(lib?.slots.map((s) => s.id)).toEqual(["1", "3"]);
  });

  it("get asks nothing without auth", async () => {
    const f = fakeFetch(() => jsonRes({}));
    const api = new LibraryApi({ fetch: f.fn, headers: () => null });
    expect(await api.get()).toBeNull();
    expect(f.calls).toHaveLength(0);
  });

  it("parseLibrary drops what is not safe", () => {
    const lib = parseLibrary({
      active: false,
      slots: [
        slot("7"),
        slot("2", { url: "/api/rooms/K7DX/sounds/1" }),
        slot("3", { url: "//x.test" }),
        slot("4", { ms: 0 }),
        slot("5", { name: "" }),
        slot("1"),
      ],
    });
    expect(lib).toEqual({ active: false, slots: [slot("1")] });
    expect(parseLibrary({ slots: [] })).toBeNull();
    expect(parseLibrary(null)).toBeNull();
  });

  it("save sends the mp3 with its name", async () => {
    const f = fakeFetch(() => jsonRes({ active: true, slots: [slot("3", { name: "Air horn" })] }));
    const api = new LibraryApi({ fetch: f.fn, headers: () => ({ authorization: "Bearer k" }) });
    const bytes = new Uint8Array([1, 2, 3]);
    const res = await api.save("3", bytes, "Air horn");
    const call = f.calls[0]!;
    expect(call.url).toBe("/api/sounds/3?name=Air%20horn");
    expect(call.init?.method).toBe("PUT");
    expect(new Headers(call.init?.headers).get("content-type")).toBe("audio/mpeg");
    expect(call.init?.body).toBe(bytes);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.library.slots[0]!.name).toBe("Air horn");
  });

  it("a refused write gives the server's words", async () => {
    const words = "This sound is too long. A sound can be 3 seconds at most.";
    const f = fakeFetch(() => jsonRes({ error: words }, 422));
    const api = new LibraryApi({ fetch: f.fn, headers: () => ({}) });
    expect(await api.save("1", new Uint8Array(1), "x")).toEqual({ ok: false, error: words });
    const down = new LibraryApi({
      fetch: (async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch,
      headers: () => ({}),
    });
    expect(await down.remove("1")).toEqual({ ok: false, error: SAVE_FAILED });
    expect(await down.rename("1", "a")).toEqual({ ok: false, error: SAVE_FAILED });
  });

  it("rename and remove use PATCH and DELETE", async () => {
    const f = fakeFetch(() => jsonRes({ active: true, slots: [] }));
    const api = new LibraryApi({ fetch: f.fn, headers: () => ({}) });
    await api.rename("2", "New");
    expect(f.calls[0]!.init?.method).toBe("PATCH");
    expect(f.calls[0]!.init?.body).toBe(JSON.stringify({ name: "New" }));
    await api.remove("2");
    expect(f.calls[1]!.init?.method).toBe("DELETE");
  });

  it("hasMySounds asks once", async () => {
    const f = fakeFetch(() => jsonRes({ active: true, slots: [] }));
    const api = new LibraryApi({ fetch: f.fn, headers: () => ({ authorization: "Bearer once" }) });
    expect(await hasMySounds(api)).toBe(true);
    expect(await hasMySounds(api)).toBe(true);
    expect(f.calls).toHaveLength(1);
    const g = fakeFetch(() => jsonRes({ error: "no" }, 403));
    const denied = new LibraryApi({ fetch: g.fn, headers: () => ({ authorization: "Bearer other" }) });
    expect(await hasMySounds(denied)).toBe(false);
  });
});
