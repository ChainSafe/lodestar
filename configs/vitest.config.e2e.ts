import path from "node:path";
import {defineProject} from "vitest/config";

export const e2eProjectConfig = defineProject({
  test: {
    name: "e2e",
    include: ["**/test/e2e/**/*.test.ts"],
    setupFiles: [
      path.join(__dirname, "../scripts/vitest/setupFiles/customMatchers.ts"),
      path.join(__dirname, "../scripts/vitest/setupFiles/dotenv.ts"),
      path.join(__dirname, "../scripts/vitest/setupFiles/lodestarPreset.ts"),
    ],
    env: {
      LODESTAR_PRESET: "minimal",
    },
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
