import { describe, expect, it } from "vitest";
import { register, shouldIntercept } from "../src/router.ts";

const origin = "https://couchparty.example";
const link = (href: string, attrs: { target?: string; download?: boolean } = {}) => {
  const u = new URL(href, origin);
  return {
    target: attrs.target ?? "",
    origin: u.origin,
    pathname: u.pathname,
    hasAttribute: (n: string) => n === "download" && !!attrs.download,
  };
};

describe("in-app link clicks", () => {
  register("/play", () => ({ mount() {}, destroy() {} }));
  register("/room/:code", () => ({ mount() {}, destroy() {} }));

  it("keeps links to routes in-app", () => {
    expect(shouldIntercept(link("/play"), origin)).toBe(true);
    expect(shouldIntercept(link("/room/ABCD"), origin)).toBe(true);
  });

  it("lets paths no route answers load for real, query and all", () => {
    expect(shouldIntercept(link("/account?next=/room/ABCD"), origin)).toBe(false);
    expect(shouldIntercept(link("/"), origin)).toBe(false);
  });

  it("leaves other origins, new tabs and downloads alone", () => {
    expect(shouldIntercept(link("https://nodejs.org/play"), origin)).toBe(false);
    expect(shouldIntercept(link("/play", { target: "_blank" }), origin)).toBe(false);
    expect(shouldIntercept(link("/play", { download: true }), origin)).toBe(false);
  });
});
