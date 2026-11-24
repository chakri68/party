/**
 * A small fake R2 bucket over a Map: get, head, put (with onlyIf), delete (one
 * key or many) and list (prefix, limit, cursor). Enough for host sounds.
 */
export function fakeBucket() {
  const objects = new Map<string, { bytes: Uint8Array; etag: string }>();
  let n = 0;
  const state = { failDelete: false, listCalls: 0, headCalls: 0, pageSize: 1000, beforeDelete: null as null | (() => Promise<unknown>) };
  const toBytes = (value: unknown): Uint8Array => {
    if (typeof value === "string") return new TextEncoder().encode(value);
    if (value instanceof Uint8Array) return new Uint8Array(value);
    if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
    throw new Error("fake bucket: unsupported value");
  };
  const meta = (key: string, o: { bytes: Uint8Array; etag: string }) => ({ key, etag: o.etag, httpEtag: `"${o.etag}"`, size: o.bytes.byteLength });
  const bucket = {
    async head(key: string) {
      state.headCalls++;
      const o = objects.get(key);
      return o ? meta(key, o) : null;
    },
    async get(key: string) {
      const o = objects.get(key);
      if (!o) return null;
      const bytes = o.bytes;
      return {
        ...meta(key, o),
        body: new Response(bytes).body,
        httpMetadata: {},
        writeHttpMetadata() {},
        async text() {
          return new TextDecoder().decode(bytes);
        },
        async arrayBuffer() {
          return bytes.slice().buffer;
        },
      };
    },
    async put(key: string, value: unknown, opts?: { onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } }) {
      const want = opts?.onlyIf?.etagMatches;
      if (want !== undefined && objects.get(key)?.etag !== want) return null;
      if (opts?.onlyIf?.etagDoesNotMatch === "*" && objects.has(key)) return null;
      const o = { bytes: toBytes(value), etag: `e${++n}` };
      objects.set(key, o);
      return meta(key, o);
    },
    async delete(keys: string | string[]) {
      if (state.failDelete) throw new Error("R2 is down");
      const hook = state.beforeDelete;
      state.beforeDelete = null;
      if (hook) await hook();
      for (const k of Array.isArray(keys) ? keys : [keys]) objects.delete(k);
    },
    async list(opts: { prefix?: string; limit?: number; cursor?: string } = {}) {
      state.listCalls++;
      const all = [...objects.keys()].filter((k) => k.startsWith(opts.prefix ?? "")).sort();
      // The cursor is the last key given, so keys deleted between pages don't shift it.
      const after = opts.cursor ? all.filter((k) => k > opts.cursor!) : all;
      const limit = Math.min(opts.limit ?? state.pageSize, state.pageSize);
      const page = after.slice(0, limit);
      const truncated = after.length > limit;
      return {
        objects: page.map((k) => meta(k, objects.get(k)!)),
        delimitedPrefixes: [],
        ...(truncated ? { truncated: true as const, cursor: page.at(-1)! } : { truncated: false as const }),
      };
    },
  };
  return { bucket: bucket as unknown as R2Bucket, objects, state };
}
