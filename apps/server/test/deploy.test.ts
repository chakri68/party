import { describe, expect, it } from "vitest";
import { deploySteps } from "../../../scripts/deploy.mjs";

type Run = { cmd: string; args: string[]; env?: Record<string, string> };
type Step = Run | { rm: string };
const steps = (dry: boolean) => deploySteps(dry) as Step[];
const isRun = (s: Step): s is Run => "cmd" in s;
const buildIndex = (s: Step[]) => s.findIndex((x) => isRun(x) && x.args.includes("build"));
const deployStep = (s: Step[]) => s.filter(isRun).find((x) => x.args.includes("deploy"))!;

describe("deploySteps", () => {
  it("uploads both exports before anything builds", () => {
    const s = steps(false);
    const ups = s.flatMap((x, i) => (isRun(x) && x.args.includes("--upload") ? [i] : []));
    expect(ups).toHaveLength(2);
    expect((s[ups[0]!] as Run).args.join(" ")).toContain("games/blind-rally/scripts/export-godot.mjs");
    expect((s[ups[1]!] as Run).args.join(" ")).toContain("games/treasure-hunt/scripts/export-godot.mjs");
    const b = buildIndex(s);
    expect(b).toBeGreaterThan(-1);
    for (const i of ups) expect(i).toBeLessThan(b);
  });

  it("builds with both lobby flags", () => {
    const s = steps(false);
    const b = s[buildIndex(s)] as Run;
    expect(b.args).toEqual(["--filter", "@games/web", "build"]);
    expect(b.env).toEqual({ VITE_BLIND_RALLY: "1", VITE_TREASURE_HUNT: "1" });
  });

  it("drops both godot dirs from dist before deploying", () => {
    const s = steps(false);
    const rms = s.flatMap((x, i) => ("rm" in x ? [{ rm: x.rm.replace(/\\/g, "/"), i }] : []));
    expect(rms.map((r) => r.rm.split("apps/web/")[1])).toEqual(["dist/blind-rally/godot", "dist/treasure-hunt/godot"]);
    const d = s.indexOf(deployStep(s));
    for (const r of rms) {
      expect(r.i).toBeGreaterThan(buildIndex(s));
      expect(r.i).toBeLessThan(d);
    }
  });

  it("deploys with both server flags", () => {
    const a = deployStep(steps(false)).args;
    expect(a).toContain("wrangler");
    expect(a.join(" ")).toContain("--var BLIND_RALLY:1 --var TREASURE_HUNT:1");
  });

  it("passes --dry-run to both uploads and the deploy, and not to the build", () => {
    const dry = steps(true);
    const ups = dry.filter(isRun).filter((x) => x.args.includes("--upload"));
    expect(ups).toHaveLength(2);
    for (const u of ups) expect(u.args).toContain("--dry-run");
    expect(deployStep(dry).args).toContain("--dry-run");
    expect((dry[buildIndex(dry)] as Run).args).not.toContain("--dry-run");
    for (const x of steps(false).filter(isRun)) expect(x.args).not.toContain("--dry-run");
  });
});
