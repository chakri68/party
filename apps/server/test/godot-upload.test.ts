import { describe, expect, it } from "vitest";
import { flagValue } from "../../../scripts/godot-upload.mjs";

describe("godot-upload flags", () => {
  it("reads the value after a flag", () => {
    expect(flagValue(["--upload", "--bucket", "couchparty-godot"], "--bucket")).toBe("couchparty-godot");
  });

  it("is undefined when the flag is absent", () => {
    expect(flagValue(["--upload", "--local"], "--bucket")).toBeUndefined();
  });

  it("throws when the value is missing or is another flag", () => {
    expect(() => flagValue(["--bucket"], "--bucket")).toThrow("--bucket needs a value");
    expect(() => flagValue(["--bucket", "--local"], "--bucket")).toThrow("--bucket needs a value");
  });
});
