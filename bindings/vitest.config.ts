import {defineConfig} from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/*.test.ts"],
    maxWorkers: 8,
    pool: "forks",
    setupFiles: ["./test/utils/network-setup.ts"],
  },
});
