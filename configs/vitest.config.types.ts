import path from "node:path";
import {defineProject} from "vitest/config";

export const typesTestProject = defineProject({
  test: {
    name: "types",
    include: ["**/test/types/**/*.d.ts"],
    setupFiles: [
      path.join(import.meta.dirname, "../scripts/vitest/setupFiles/customMatchers.ts"),
      path.join(import.meta.dirname, "../scripts/vitest/setupFiles/dotenv.ts"),
      path.join(import.meta.dirname, "../scripts/vitest/setupFiles/lodestarPreset.ts"),
    ],
    typecheck: {
      enabled: true,
    },
  },
});
