import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script, no types
import { parseArgs } from "../../../scripts/admin.mjs";

describe("admin cli parseArgs", () => {
  it("grant with days, default url", () => {
    expect(parseArgs(["grant", "a@x.com", "--days", "30"])).toEqual({
      url: "https://couchpartygames.com",
      request: { method: "POST", path: "/api/admin/grant", body: { email: "a@x.com", days: 30 } },
    });
  });
  it("grant --forever and --local", () => {
    const p = parseArgs(["--local", "grant", "a@x.com", "--forever"]);
    expect(p.url).toBe("http://127.0.0.1:8788");
    expect(p.request.body).toEqual({ email: "a@x.com", days: null });
  });
  it("--url overrides and trims trailing slash", () => {
    expect(parseArgs(["--url", "http://h:1/", "code", "list"]).url).toBe("http://h:1");
  });
  it("revoke-grants", () => {
    expect(parseArgs(["revoke-grants", "a@x.com"]).request).toEqual({
      method: "POST", path: "/api/admin/revoke-grants", body: { email: "a@x.com" },
    });
  });
  it("code new with options and defaults", () => {
    expect(parseArgs(["code", "new", "--uses", "3", "--days", "30", "--note", "family", "--prefix", "FAM"]).request.body).toEqual({
      maxUses: 3, days: 30, note: "family", prefix: "FAM",
    });
    expect(parseArgs(["code", "new", "--forever"]).request.body).toEqual({ maxUses: 1, days: null });
  });
  it("code list and revoke", () => {
    expect(parseArgs(["code", "list"]).request).toEqual({ method: "GET", path: "/api/admin/codes" });
    expect(parseArgs(["code", "revoke", "FAM-AAAA-BBBB"]).request).toEqual({
      method: "POST", path: "/api/admin/codes/FAM-AAAA-BBBB/revoke",
    });
  });
  it("help and errors", () => {
    expect(parseArgs(["--help"])).toEqual({ help: true });
    expect(parseArgs([])).toEqual({ help: true });
    expect(() => parseArgs(["grant"])).toThrow(/email/);
    expect(() => parseArgs(["grant", "a@x.com", "--days", "x"])).toThrow(/days/);
    expect(() => parseArgs(["grant", "a@x.com", "--days", "3", "--forever"])).toThrow(/days/);
    expect(() => parseArgs(["bogus"])).toThrow(/Unknown/);
  });
});
