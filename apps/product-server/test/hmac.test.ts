import { describe, expect, it } from "vitest";
import { hmacHex, verifyHmacHex } from "../src/billing/hmac.ts";

const MSG = "The quick brown fox jumps over the lazy dog";
const H = "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8";

describe("hmac", () => {
  it("matches the known HMAC-SHA256 vector", async () => {
    expect(await hmacHex("key", MSG)).toBe(H);
  });

  it("verifies a good signature, case-insensitively", async () => {
    expect(await verifyHmacHex("key", MSG, H)).toBe(true);
    expect(await verifyHmacHex("key", MSG, H.toUpperCase())).toBe(true);
  });

  it("rejects a changed message or key", async () => {
    expect(await verifyHmacHex("key", MSG.toLowerCase(), H)).toBe(false);
    expect(await verifyHmacHex("other", MSG, H)).toBe(false);
  });

  it("returns false, never throws, on bad hex", async () => {
    expect(await verifyHmacHex("key", "x", "zz")).toBe(false);
    expect(await verifyHmacHex("key", "x", "")).toBe(false);
    expect(await verifyHmacHex("key", "x", "abc")).toBe(false);
    expect(await verifyHmacHex("key", "x", H.slice(0, 62))).toBe(false);
  });
});
