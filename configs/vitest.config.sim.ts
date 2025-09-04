import path from "node:path";
import {defineProject} from "vitest/config";

export const simTestProject = defineProject({
  test: {
    name: "sim",
    include: ["**/test/sim/**/*.test.ts"],
    setupFiles: [
      path.join(__dirname, "../scripts/vitest/setupFiles/customMatchers.ts"),
      path.join(__dirname, "../scripts/vitest/setupFiles/dotenv.ts"),
      path.join(__dirname, "../scripts/vitest/setupFiles/lodestarPreset.ts"),
    ],
    env: {
      LODESTAR_PRESET: "mainnet",
    },
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    sequence: {
      concurrent: false,
      shuffle: false,
    },
  },
});
