import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{apps,packages,games}/*/{src,test}/**/*.test.ts", "games/*/test/**/*.test.ts"],
  },
});
