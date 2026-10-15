import path from "node:path";
import {defineProject} from "vitest/config";

export const eip8025TestProject = defineProject({
  test: {
    name: "eip8025",
    include: ["**/test/8025/**/*.test.ts"],
    setupFiles: [
      path.join(import.meta.dirname, "../scripts/vitest/setupFiles/customMatchers.ts"),
      path.join(import.meta.dirname, "../scripts/vitest/setupFiles/dotenv.ts"),
      path.join(import.meta.dirname, "../scripts/vitest/setupFiles/lodestarPreset.ts"),
      path.join(import.meta.dirname, "../scripts/vitest/setupFiles/pubkeyCache.ts"),
    ],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    pool: "forks",
    env: {
      LODESTAR_PRESET: "mainnet",
    },
  },
});
