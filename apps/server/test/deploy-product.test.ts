import { describe, expect, it } from "vitest";
import { deploySteps as masterSteps } from "../../../scripts/deploy.mjs";
import { deploySteps } from "../../../scripts/deploy-product.mjs";

type Run = { cmd: string; args: string[]; env?: Record<string, string> };
type Step = Run | { rm: string } | { say: string };
const steps = (dry: boolean) => deploySteps(dry) as Step[];
const isRun = (s: Step): s is Run => "cmd" in s;
const line = (s: Step) => (isRun(s) ? `${s.cmd} ${s.args.join(" ")}` : "rm" in s ? `rm ${s.rm.replace(/\\/g, "/")}` : s.say);

describe("deploySteps (product)", () => {
  it("runs uploads, build, cleanup, migrations, deploy in that order", () => {
    const l = steps(false).map(line);
    const at = (needle: string) => l.findIndex((x) => x.includes(needle));
    const order = [
      "games/blind-rally/scripts/export-godot.mjs",
      "games/treasure-hunt/scripts/export-godot.mjs",
      "--filter @games/product-web build",
      "apps/product-web/dist/blind-rally/godot",
      "apps/product-web/dist/treasure-hunt/godot",
      "d1 migrations apply couchparty --remote",
      "wrangler deploy",
    ].map(at);
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(l).toHaveLength(7);
  });

  it("uploads both exports to couchparty-godot", () => {
    const ups = steps(false).filter(isRun).filter((x) => x.args.includes("--upload"));
    expect(ups).toHaveLength(2);
    for (const u of ups) expect(u.args.join(" ")).toContain("--bucket couchparty-godot");
  });

  it("builds product-web with both lobby flags", () => {
    const b = steps(false).filter(isRun).find((x) => x.args.includes("build"))!;
    expect(b.args).toEqual(["--filter", "@games/product-web", "build"]);
    expect(b.env).toEqual({ VITE_BLIND_RALLY: "1", VITE_TREASURE_HUNT: "1" });
  });

  it("migrates and deploys from apps/product-server", () => {
    const runs = steps(false).filter(isRun);
    const mig = runs.find((x) => x.args.includes("migrations"))!;
    const dep = runs.find((x) => x.args.includes("deploy"))!;
    for (const r of [mig, dep]) expect(r.args.slice(0, 4)).toEqual(["--filter", "@games/product-server", "exec", "wrangler"]);
  });

  it("never turns DEV_TOOLS on", () => {
    for (const dry of [false, true]) {
      const all = JSON.stringify(steps(dry));
      expect(all).not.toMatch(/DEV_TOOLS/);
    }
  });

  it("passes --dry-run to uploads and deploy only", () => {
    const runs = steps(true).filter(isRun);
    for (const r of runs) {
      const wants = r.args.includes("--upload") || r.args.includes("deploy");
      expect(r.args.includes("--dry-run"), line(r)).toBe(wants);
    }
    for (const r of steps(false).filter(isRun)) expect(r.args).not.toContain("--dry-run");
  });

  it("leaves the master deploy on its own bucket", () => {
    const all = JSON.stringify(masterSteps(false));
    expect(all).not.toContain("--bucket");
    expect(all).not.toContain("couchparty");
  });
});
