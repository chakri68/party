/** A recording fake CanvasRenderingContext2D for node tests. Every method is a
 * no-op that records its name; every property can be set and read back.
 * Gradient and pattern makers return a stub that takes colour stops. */
export interface FakeCtx {
  ctx: CanvasRenderingContext2D;
  calls: string[];
  /** Every call with its arguments and every property set, numbers rounded to 2 places. */
  trace: string[];
  count(name: string): number;
}

const MAKERS = new Set(["createLinearGradient", "createRadialGradient", "createConicGradient", "createPattern"]);

export function fakeCtx(): FakeCtx {
  const calls: string[] = [];
  const trace: string[] = [];
  const show = (x: unknown) => (typeof x === "number" ? String(Math.round(x * 100) / 100 + 0) : typeof x === "object" ? "obj" : String(x));
  const props: Record<string | symbol, unknown> = {};
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get(_t, key) {
      if (key in props) return props[key];
      if (typeof key !== "string") return undefined;
      return (...args: unknown[]) => {
        calls.push(key);
        trace.push(`${key}(${args.map(show).join(",")})`);
        if (MAKERS.has(key)) return { addColorStop: () => calls.push("addColorStop"), setTransform: () => {} };
        if (key === "measureText") return { width: 0 };
        return undefined;
      };
    },
    set(_t, key, value) {
      props[key] = value;
      trace.push(`${String(key)}=${show(value)}`);
      return true;
    },
  });
  return { ctx, calls, trace, count: (name) => calls.filter((c) => c === name).length };
}
