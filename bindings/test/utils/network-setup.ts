import {beforeEach} from "vitest";

// Vitest retains a test's rejected assertion values until that test finishes, so wait before the next one.
beforeEach(async ({task}) => {
  if (!task.file.filepath.includes("/network")) return;
  const {runtimeReleased} = await import("./network.js");
  await runtimeReleased();
});
