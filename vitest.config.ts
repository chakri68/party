import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // One worker per physical core. The default (logical cores - 1) puts two
    // CPU-bound simulation files on each core (Treasure Hunt seeds, Dominion,
    // the balance runs), each at half speed, and their timeouts then trip.
    // Half the workers finished the whole suite faster, too (58 s against 71 s).
    maxWorkers: "50%",
    include: ["{apps,packages,games}/*/{src,test}/**/*.test.ts", "games/*/test/**/*.test.ts"],
  },
});
