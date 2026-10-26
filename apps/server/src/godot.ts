// Blind Rally's Godot export, served from R2 at the same origin (map D2).
//
// The iframe bridge touches iframe.contentWindow, so the export has to live on
// this origin, and its .wasm is over the 25 MiB static-asset limit, so it
// can't be an asset. export-godot.mjs --upload puts each hashed dir in the
// bucket under the same path the client asks for; this hands it back.
//
// Compression: big files are uploaded brotli-11 with contentEncoding "br" in
// their R2 metadata, and go out as-is via encodeBody: "manual". Without
// "manual" the runtime would compress them a second time. Godot's progress
// bar counts decompressed bytes against GODOT_CONFIG.fileSizes, so it reads
// "x of 42 MB" while ~10 MB crosses the wire; Content-Length plays no part.

/** The parts of R2 this touches, so tests can fake it. */
export type GodotBucket = Pick<R2Bucket, "get" | "head">;

export interface GodotEnv {
  BLIND_RALLY?: string;
  BLIND_RALLY_GODOT?: GodotBucket;
}

/** Hash from export-godot.mjs (10 hex), then one plain file name. Anything else is a 404. */
const PATH = /^\/blind-rally\/godot\/([0-9a-f]{10})\/([A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*)$/;

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  wasm: "application/wasm", // streaming compile refuses anything else
  pck: "application/octet-stream",
  png: "image/png",
  json: "application/json",
};

export const IMMUTABLE = "public, max-age=31536000, immutable";

const notFound = () => new Response("Not Found", { status: 404, headers: { "content-type": "text/plain" } });

/** null when the path isn't ours, so the caller carries on routing. */
export async function serveGodot(request: Request, env: GodotEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/blind-rally/godot/")) return null;
  // Self-hosted copies and flag-off deploys: the game doesn't exist, nor does its engine.
  if (env.BLIND_RALLY !== "1" || !env.BLIND_RALLY_GODOT) return notFound();
  const m = PATH.exec(url.pathname);
  if (!m) return notFound();
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }

  const [, hash, file] = m as unknown as [string, string, string];
  const key = `blind-rally/godot/${hash}/${file}`;
  const bucket = env.BLIND_RALLY_GODOT;

  if (request.method === "HEAD") {
    const obj = await bucket.head(key);
    if (!obj) return notFound();
    const headers = headersFor(obj, file);
    headers.set("content-length", String(obj.size));
    return new Response(null, { headers, encodeBody: encodedAs(obj) });
  }

  // A byte range of brotli bytes means nothing to a client that asked for a
  // range of the file, so ranges are only honoured on unencoded objects. Godot
  // never sends one; the extra head() only happens when someone does.
  let range: { offset: number; length: number } | undefined;
  const rangeHeader = request.headers.get("range");
  if (rangeHeader) {
    const meta = await bucket.head(key);
    if (!meta) return notFound();
    if (!meta.httpMetadata?.contentEncoding) {
      const r = parseRange(rangeHeader, meta.size);
      if (r === "unsatisfiable") {
        return new Response(null, { status: 416, headers: { "content-range": `bytes */${meta.size}` } });
      }
      range = r ?? undefined;
    }
  }

  const obj = await bucket.get(key, { onlyIf: request.headers, range });
  if (!obj) return notFound();
  const headers = headersFor(obj, file);
  // onlyIf failed: R2 hands back the metadata without a body.
  if (!("body" in obj)) return new Response(null, { status: 304, headers });

  if (range) {
    headers.set("content-range", `bytes ${range.offset}-${range.offset + range.length - 1}/${obj.size}`);
    headers.set("content-length", String(range.length));
    return new Response(obj.body, { status: 206, headers });
  }
  return new Response(obj.body, { headers, encodeBody: encodedAs(obj) });
}

function headersFor(obj: R2Object, file: string): Headers {
  const headers = new Headers();
  obj.writeHttpMetadata(headers); // content-encoding, mostly
  const ext = file.slice(file.lastIndexOf(".") + 1);
  headers.set("content-type", TYPES[ext] ?? "application/octet-stream");
  // Content-hashed path: a given URL never changes, so nobody should ask twice.
  headers.set("cache-control", IMMUTABLE);
  headers.set("etag", obj.httpEtag);
  headers.set("x-content-type-options", "nosniff");
  if (obj.httpMetadata?.contentEncoding) headers.set("vary", "accept-encoding");
  else headers.set("accept-ranges", "bytes");
  return headers;
}

/** "manual" for anything stored compressed, so it isn't compressed again on the way out. */
const encodedAs = (obj: R2Object) => (obj.httpMetadata?.contentEncoding ? "manual" : "automatic");

/**
 * One "bytes=a-b" / "bytes=a-" / "bytes=-n" range against a known size. null
 * means ignore it and send the lot (multiple ranges, junk), which HTTP allows.
 */
export function parseRange(header: string, size: number): { offset: number; length: number } | "unsatisfiable" | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") {
    const length = Math.min(Number(m[2]), size);
    return length === 0 ? "unsatisfiable" : { offset: size - length, length };
  }
  const offset = Number(m[1]);
  if (offset >= size) return "unsatisfiable";
  const last = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (last < offset) return null;
  return { offset, length: last - offset + 1 };
}
