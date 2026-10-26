import { describe, expect, it } from "vitest";
import { IMMUTABLE, parseRange, serveGodot, type GodotBucket, type GodotEnv } from "../src/godot.ts";

// ---------------------------------------------------------------------------
// A fake R2 bucket: enough of get/head (onlyIf If-None-Match, Range) to drive
// the route. Bodies are stored as-is, like R2: the "br" files hold whatever
// bytes the upload put there.
// ---------------------------------------------------------------------------

interface Stored {
  bytes: Uint8Array;
  contentEncoding?: string;
}

class FakeBucket {
  gets: string[] = [];
  readonly objects: Record<string, Stored>;
  constructor(objects: Record<string, Stored>) {
    this.objects = objects;
  }

  private meta(key: string, stored: Stored, range?: R2Range) {
    const httpMetadata = stored.contentEncoding ? { contentEncoding: stored.contentEncoding } : {};
    return {
      key,
      size: stored.bytes.length,
      etag: `etag-${key.length}`,
      httpEtag: `"etag-${key.length}"`,
      httpMetadata,
      range,
      writeHttpMetadata(headers: Headers) {
        if (httpMetadata.contentEncoding) headers.set("content-encoding", httpMetadata.contentEncoding);
      },
    };
  }

  async head(key: string) {
    const stored = this.objects[key];
    return stored ? (this.meta(key, stored) as unknown as R2Object) : null;
  }

  async get(key: string, options?: R2GetOptions) {
    this.gets.push(key);
    const stored = this.objects[key];
    if (!stored) return null;
    const meta = this.meta(key, stored);
    const onlyIf = options?.onlyIf;
    if (onlyIf instanceof Headers && onlyIf.get("if-none-match") === meta.httpEtag) {
      return meta as unknown as R2Object; // precondition failed: no body
    }
    let bytes = stored.bytes;
    let range: R2Range | undefined;
    const r = options?.range;
    if (r && !(r instanceof Headers) && "offset" in r && r.offset !== undefined && r.length !== undefined) {
      range = r;
      bytes = bytes.slice(r.offset, r.offset + r.length);
    }
    return {
      ...this.meta(key, stored, range),
      body: new Response(bytes).body,
    } as unknown as R2ObjectBody;
  }
}

const HASH = "11ea73d729";
const base = `https://party-games.chakri.me/blind-rally/godot/${HASH}`;
const bytes = (s: string) => new TextEncoder().encode(s);

function setup(overrides: Partial<GodotEnv> = {}) {
  const bucket = new FakeBucket({
    [`blind-rally/godot/${HASH}/index.wasm`]: { bytes: bytes("brotli-wasm"), contentEncoding: "br" },
    [`blind-rally/godot/${HASH}/index.html`]: { bytes: bytes("brotli-html"), contentEncoding: "br" },
    [`blind-rally/godot/${HASH}/index.png`]: { bytes: bytes("0123456789") },
    [`blind-rally/godot/${HASH}/.uploaded`]: { bytes: bytes("") },
  });
  // get() is overloaded on R2Bucket; the fake's one signature covers both.
  const env: GodotEnv = { BLIND_RALLY: "1", BLIND_RALLY_GODOT: bucket as unknown as GodotBucket, ...overrides };
  return { bucket, env };
}

const get = (url: string, init?: RequestInit) => new Request(url, init);

describe("serveGodot", () => {
  it("leaves other paths alone", async () => {
    const { env } = setup();
    expect(await serveGodot(get("https://x/api/rooms"), env)).toBeNull();
    expect(await serveGodot(get("https://x/blind-rally/other"), env)).toBeNull();
  });

  it("serves the wasm as stored, brotli and all, with the right headers", async () => {
    const { env } = setup();
    const res = (await serveGodot(get(`${base}/index.wasm`), env))!;
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/wasm");
    expect(res.headers.get("content-encoding")).toBe("br");
    expect(res.headers.get("cache-control")).toBe(IMMUTABLE);
    expect(res.headers.get("etag")).toMatch(/^".+"$/);
    expect(res.headers.get("vary")).toBe("accept-encoding");
    expect(res.headers.get("accept-ranges")).toBeNull();
    expect(await res.text()).toBe("brotli-wasm");
  });

  it("types each file by extension", async () => {
    const { env } = setup();
    expect((await serveGodot(get(`${base}/index.html`), env))!.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect((await serveGodot(get(`${base}/index.png`), env))!.headers.get("content-type")).toBe("image/png");
  });

  it("404s everything when the flag is off, without touching R2", async () => {
    for (const flag of ["0", undefined]) {
      const { env, bucket } = setup({ BLIND_RALLY: flag });
      const res = (await serveGodot(get(`${base}/index.wasm`), env))!;
      expect(res.status).toBe(404);
      expect(bucket.gets).toEqual([]);
    }
  });

  it("404s when there's no bucket bound (self-host strips it)", async () => {
    const res = (await serveGodot(get(`${base}/index.wasm`), { BLIND_RALLY: "1" }))!;
    expect(res.status).toBe(404);
  });

  it("404s an unknown hash or file instead of falling back to the SPA", async () => {
    const { env } = setup();
    expect((await serveGodot(get(`https://x/blind-rally/godot/0000000000/index.wasm`), env))!.status).toBe(404);
    expect((await serveGodot(get(`${base}/nope.pck`), env))!.status).toBe(404);
    expect((await serveGodot(get(`${base}/`), env))!.status).toBe(404);
  });

  it("rejects traversal, odd hashes and dotfiles before R2 sees them", async () => {
    const { env, bucket } = setup();
    for (const path of [
      `/blind-rally/godot/${HASH}/%2e%2e%2fsecret`,
      `/blind-rally/godot/${HASH}/..%2Findex.wasm`,
      `/blind-rally/godot/${HASH}/a/index.wasm`,
      `/blind-rally/godot/${HASH}/.uploaded`,
      `/blind-rally/godot/${HASH}/index.wasm%00`,
      `/blind-rally/godot/11EA73D729/index.wasm`,
      `/blind-rally/godot/../godot/${HASH}/index.wasm/..`,
      `/blind-rally/godot/${HASH}`,
    ]) {
      const res = (await serveGodot(get(`https://x${path}`), env))!;
      expect(res.status, path).toBe(404);
    }
    expect(bucket.gets).toEqual([]);
  });

  it("answers HEAD with headers and a length, but no body", async () => {
    const { env, bucket } = setup();
    const res = (await serveGodot(get(`${base}/index.wasm`, { method: "HEAD" }), env))!;
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/wasm");
    expect(res.headers.get("content-length")).toBe(String("brotli-wasm".length));
    expect(res.body).toBeNull();
    expect(bucket.gets).toEqual([]);
  });

  it("refuses other methods", async () => {
    const { env } = setup();
    const res = (await serveGodot(get(`${base}/index.wasm`, { method: "POST" }), env))!;
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
  });

  it("304s a matching If-None-Match", async () => {
    const { env } = setup();
    const first = (await serveGodot(get(`${base}/index.wasm`), env))!;
    const etag = first.headers.get("etag")!;
    const res = (await serveGodot(get(`${base}/index.wasm`, { headers: { "if-none-match": etag } }), env))!;
    expect(res.status).toBe(304);
    expect(res.headers.get("etag")).toBe(etag);
    expect(res.body).toBeNull();
  });

  it("serves ranges of unencoded files", async () => {
    const { env } = setup();
    const res = (await serveGodot(get(`${base}/index.png`, { headers: { range: "bytes=2-5" } }), env))!;
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(res.headers.get("content-length")).toBe("4");
    expect(await res.text()).toBe("2345");
  });

  it("416s a range past the end", async () => {
    const { env } = setup();
    const res = (await serveGodot(get(`${base}/index.png`, { headers: { range: "bytes=50-" } }), env))!;
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */10");
  });

  it("ignores ranges on brotli files: the whole thing, 200", async () => {
    const { env } = setup();
    const res = (await serveGodot(get(`${base}/index.wasm`, { headers: { range: "bytes=0-3" } }), env))!;
    expect(res.status).toBe(200);
    expect(res.headers.get("content-range")).toBeNull();
    expect(await res.text()).toBe("brotli-wasm");
  });
});

describe("parseRange", () => {
  it("reads the three single-range shapes and clamps to the size", () => {
    expect(parseRange("bytes=2-5", 10)).toEqual({ offset: 2, length: 4 });
    expect(parseRange("bytes=7-", 10)).toEqual({ offset: 7, length: 3 });
    expect(parseRange("bytes=-3", 10)).toEqual({ offset: 7, length: 3 });
    expect(parseRange("bytes=-30", 10)).toEqual({ offset: 0, length: 10 });
    expect(parseRange("bytes=5-99", 10)).toEqual({ offset: 5, length: 5 });
  });

  it("calls past-the-end unsatisfiable and ignores what it doesn't do", () => {
    expect(parseRange("bytes=10-", 10)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 10)).toBe("unsatisfiable");
    expect(parseRange("bytes=0-1,4-5", 10)).toBeNull();
    expect(parseRange("bytes=5-2", 10)).toBeNull();
    expect(parseRange("items=0-1", 10)).toBeNull();
    expect(parseRange("bytes=-", 10)).toBeNull();
  });
});
